mod claude;
mod codex;
mod connection;
mod credentials;
mod repositories;
mod run_wrapper;
mod session_store;
mod service;

use clap::{Parser, Subcommand};
use tracing::{error, info};

use crate::connection::AgentConnection;
use crate::credentials::{credentials_path, load_credentials, save_credentials, Credentials};
use crate::service::{
    install_service, is_service_active, read_installed_service_config, service_path,
    show_service_status, uninstall_service, InstallServiceOptions, SERVICE_NAME,
};

const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "webmux-agent", about = "Webmux agent — connects your machine to the webmux server", version = AGENT_VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Register this agent with a webmux server
    Register {
        /// Server URL (e.g. https://webmux.example.com)
        #[arg(long)]
        server: String,
        /// One-time registration token from the server
        #[arg(long)]
        token: String,
        /// Display name for this agent (defaults to hostname)
        #[arg(long)]
        name: Option<String>,
    },
    /// Start the agent and connect to the server
    Start,
    /// Show agent status and credentials info
    Status,
    /// Manage the systemd service
    #[command(subcommand)]
    Service(ServiceCommands),
}

#[derive(Subcommand)]
enum ServiceCommands {
    /// Install and start the agent as a managed systemd user service
    Install {
        /// Disable automatic upgrades for the managed service
        #[arg(long, default_value_t = false)]
        no_auto_upgrade: bool,
    },
    /// Stop and remove the systemd user service
    Uninstall,
    /// Show systemd service status
    Status,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Register {
            server,
            token,
            name,
        } => {
            cmd_register(&server, &token, name.as_deref()).await;
        }
        Commands::Start => {
            cmd_start().await;
        }
        Commands::Status => {
            cmd_status();
        }
        Commands::Service(sub) => match sub {
            ServiceCommands::Install { no_auto_upgrade } => {
                cmd_service_install(!no_auto_upgrade);
            }
            ServiceCommands::Uninstall => {
                cmd_service_uninstall();
            }
            ServiceCommands::Status => {
                cmd_service_status();
            }
        },
    }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async fn cmd_register(server: &str, token: &str, name: Option<&str>) {
    let server_url = server.trim_end_matches('/').to_string();
    let agent_name = name
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string())
        });

    info!("Registering with server {server_url}...");
    info!("Agent name: {agent_name}");

    let body = webmux_shared::RegisterAgentRequest {
        token: token.to_string(),
        name: Some(agent_name.clone()),
    };

    let client = reqwest::Client::new();
    let url = format!("{server_url}/api/agents/register");

    let response = match client.post(&url).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to connect to server: {e}");
            std::process::exit(1);
        }
    };

    if !response.status().is_success() {
        let error_msg = match response.json::<serde_json::Value>().await {
            Ok(body) => body
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Unknown error")
                .to_string(),
            Err(_) => "Unknown error".to_string(),
        };
        error!("Registration failed: {error_msg}");
        std::process::exit(1);
    }

    let result: webmux_shared::RegisterAgentResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to parse registration response: {e}");
            std::process::exit(1);
        }
    };

    save_credentials(&Credentials {
        server_url,
        agent_id: result.agent_id.clone(),
        agent_secret: result.agent_secret,
        name: agent_name,
    });

    let creds_path = credentials_path();
    info!("Registration successful!");
    info!("Agent ID: {}", result.agent_id);
    info!("Credentials saved to {}", creds_path.display());
    println!();
    println!("Next steps:");
    println!("  webmux-agent start              # run once");
    println!("  webmux-agent service install     # install as managed systemd service");
}

async fn cmd_start() {
    let creds = match load_credentials() {
        Some(c) => c,
        None => {
            let path = credentials_path();
            error!(
                "No credentials found at {}. Run \"webmux-agent register\" first.",
                path.display()
            );
            std::process::exit(1);
        }
    };

    info!("Starting agent \"{}\"...", creds.name);
    info!("Server: {}", creds.server_url);
    info!("Agent ID: {}", creds.agent_id);

    let workspace_root = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    let connection = AgentConnection::new(
        creds.server_url,
        creds.agent_id,
        creds.agent_secret,
        workspace_root,
    );

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // Handle SIGINT/SIGTERM
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        let mut sigint =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .expect("failed to register SIGINT handler");
        let mut sigterm =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("failed to register SIGTERM handler");

        tokio::select! {
            _ = sigint.recv() => {
                info!("Received SIGINT, shutting down...");
            }
            _ = sigterm.recv() => {
                info!("Received SIGTERM, shutting down...");
            }
        }

        let _ = shutdown_tx_clone.send(true);
    });

    connection.run(shutdown_rx).await;
}

fn cmd_status() {
    let creds = match load_credentials() {
        Some(c) => c,
        None => {
            let path = credentials_path();
            println!("[agent] Not registered. No credentials found at {}.", path.display());
            return;
        }
    };

    println!("Agent Name:       {}", creds.name);
    println!("Agent Version:    {AGENT_VERSION}");
    println!("Server URL:       {}", creds.server_url);
    println!("Agent ID:         {}", creds.agent_id);
    println!(
        "Credentials File: {}",
        credentials_path().display()
    );

    match is_service_active() {
        Some(status) => println!("Service:          {status}"),
        None => println!("Service:          not installed"),
    }

    if let Some(config) = read_installed_service_config() {
        println!(
            "Auto Upgrade:     {}",
            if config.auto_upgrade { "yes" } else { "no" }
        );
    }
}

fn cmd_service_install(auto_upgrade: bool) {
    let creds = match load_credentials() {
        Some(c) => c,
        None => {
            error!("Not registered. Run \"webmux-agent register\" first.");
            std::process::exit(1);
        }
    };

    match install_service(&InstallServiceOptions {
        agent_name: creds.name,
        auto_upgrade,
    }) {
        Ok(()) => {
            println!();
            info!("Service installed and started!");
            info!("It will auto-start on boot.");
            println!();
            println!("Useful commands:");
            println!("  systemctl --user status {SERVICE_NAME}");
            println!("  journalctl --user -u {SERVICE_NAME} -f");
            println!("  webmux-agent service uninstall");
        }
        Err(e) => {
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            error!("Failed to install managed service: {e}");
            error!("Service file path: {}", service_path(&home));
            std::process::exit(1);
        }
    }
}

fn cmd_service_uninstall() {
    match uninstall_service() {
        Ok(()) => {
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            info!("Service file removed: {}", service_path(&home));
            info!("Service uninstalled.");
        }
        Err(e) => {
            error!("Failed to uninstall service: {e}");
            std::process::exit(1);
        }
    }
}

fn cmd_service_status() {
    show_service_status();
}
