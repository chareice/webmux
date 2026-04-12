mod config;
mod hub_conn;
mod pty;
mod stats;
mod service;

use std::sync::Arc;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "webmux-node", about = "webmux node daemon")]
struct Args {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Register this machine with a webmux-server instance
    Register {
        /// Hub base URL (e.g. http://localhost:3000)
        #[arg(long)]
        hub_url: String,

        /// Registration token obtained from the hub
        #[arg(long)]
        token: String,

        /// Machine name (defaults to hostname)
        #[arg(long)]
        name: Option<String>,
    },

    /// Start the machine daemon (default)
    Start {
        /// Hub WebSocket URL to connect to
        #[arg(long)]
        hub_url: Option<String>,

        /// Machine name (defaults to hostname)
        #[arg(long)]
        name: Option<String>,

        /// Machine ID (for legacy/dev mode without registration)
        #[arg(long)]
        id: Option<String>,
    },

    /// Manage systemd user service
    Service {
        #[command(subcommand)]
        action: ServiceCommands,
    },

    /// Show node status
    Status,
}

#[derive(Subcommand)]
enum ServiceCommands {
    /// Install and start as systemd user service
    Install {
        /// Disable automatic upgrades for the managed service
        #[arg(long, default_value_t = false)]
        no_auto_upgrade: bool,
    },
    /// Stop and remove the service
    Uninstall,
    /// Show service status
    Status,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    match args.command {
        Some(Command::Register {
            hub_url,
            token,
            name,
        }) => {
            run_register(hub_url, token, name).await;
        }
        Some(Command::Start { hub_url, name, id }) => {
            run_start(hub_url, name, id).await;
        }
        Some(Command::Service { action }) => match action {
            ServiceCommands::Install { no_auto_upgrade } => {
                cmd_service_install(no_auto_upgrade);
            }
            ServiceCommands::Uninstall => {
                cmd_service_uninstall();
            }
            ServiceCommands::Status => {
                service::status();
            }
        },
        Some(Command::Status) => {
            cmd_status();
        }
        None => {
            // Default to start with no overrides
            run_start(None, None, None).await;
        }
    }
}

async fn run_register(hub_url: String, token: String, name: Option<String>) {
    let machine_name = name.unwrap_or_else(|| {
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string())
    });

    // Convert ws/wss URLs to http/https for API calls
    let base = hub_url.trim_end_matches('/');
    let base = if base.contains("/ws/machine") {
        base.trim_end_matches("/ws/machine")
    } else {
        base
    };
    let http_base = if base.starts_with("wss://") {
        base.replacen("wss://", "https://", 1)
    } else if base.starts_with("ws://") {
        base.replacen("ws://", "http://", 1)
    } else {
        base.to_string()
    };
    let register_url = format!("{}/api/machines/register", http_base);

    tracing::info!("Registering machine '{}' with hub at {}", machine_name, hub_url);

    let body = serde_json::json!({
        "token": token,
        "name": machine_name,
    });

    let client = reqwest::Client::new();
    let resp = match client.post(&register_url).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to connect to hub: {}", e);
            std::process::exit(1);
        }
    };

    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        eprintln!("Registration failed (HTTP {}): {}", status, resp_text);
        std::process::exit(1);
    }

    #[derive(serde::Deserialize)]
    struct RegisterResponse {
        machine_id: String,
        machine_secret: String,
    }

    let register_resp: RegisterResponse = match serde_json::from_str(&resp_text) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to parse registration response: {}", e);
            eprintln!("Response body: {}", resp_text);
            std::process::exit(1);
        }
    };

    // Build WebSocket URL from the HTTP hub URL
    let ws_url = build_ws_url(&hub_url);

    let cfg = config::MachineConfig {
        machine_id: register_resp.machine_id.clone(),
        machine_secret: register_resp.machine_secret,
        hub_url: ws_url,
    };

    if let Err(e) = config::save_config(&cfg) {
        eprintln!("Failed to save config: {}", e);
        std::process::exit(1);
    }

    let config_path = config::config_path();
    println!("Machine registered successfully!");
    println!("  Machine ID: {}", register_resp.machine_id);
    println!("  Config saved to: {}", config_path.display());
    println!();
    println!("Start the daemon with: webmux-node start");
    println!("Install as service:    webmux-node service install");
}

/// Convert any hub URL to its WebSocket machine endpoint.
/// Handles http/https/ws/wss and avoids duplicating /ws/machine.
fn build_ws_url(hub_url: &str) -> String {
    let base = hub_url.trim_end_matches('/');
    // If already a full ws machine URL, return as-is
    if (base.starts_with("ws://") || base.starts_with("wss://")) && base.ends_with("/ws/machine") {
        return base.to_string();
    }
    // Strip /ws/machine if present, then rebuild
    let base = base.trim_end_matches("/ws/machine");
    let ws_base = if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else if base.starts_with("http://") {
        base.replacen("http://", "ws://", 1)
    } else if base.starts_with("ws://") || base.starts_with("wss://") {
        base.to_string()
    } else {
        format!("ws://{}", base)
    };
    format!("{}/ws/machine", ws_base)
}

async fn run_start(hub_url: Option<String>, name: Option<String>, id: Option<String>) {
    // Try to load config
    let loaded_config = config::load_config().ok();

    let (machine_id, machine_secret, ws_url) = if let Some(cfg) = &loaded_config {
        // Use config values, but allow CLI overrides for hub_url and name
        let url = hub_url.unwrap_or_else(|| cfg.hub_url.clone());
        (cfg.machine_id.clone(), cfg.machine_secret.clone(), url)
    } else if let Some(dev_id) = id {
        // Legacy/dev mode: no config, but --id provided
        let url = hub_url.unwrap_or_else(|| "ws://127.0.0.1:4317/ws/machine".to_string());
        tracing::warn!("Running in dev mode without authentication (no config file found)");
        (dev_id, String::new(), url)
    } else {
        eprintln!("No config file found. Please register this machine first:");
        eprintln!();
        eprintln!("  webmux-node register --hub-url <URL> --token <TOKEN>");
        eprintln!();
        eprintln!("Or run in dev mode with: webmux-node start --id <MACHINE_ID>");
        std::process::exit(1);
    };

    let machine_name = name.unwrap_or_else(|| {
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string())
    });

    tracing::info!(
        "Starting webmux-node: id={}, name={}, hub={}",
        machine_id,
        machine_name,
        ws_url
    );

    let (pty_manager, mut detach_rx) = pty::PtyManager::new();
    let pty_manager = Arc::new(pty_manager);

    // Recover tmux-backed terminals from previous run
    let recovered = pty_manager.recover_sessions();
    if !recovered.is_empty() {
        tracing::info!("Recovered {} terminals from previous session", recovered.len());
    }

    // Spawn background task to auto-reattach tmux sessions when attach process dies
    let pty_for_reattach = pty_manager.clone();
    tokio::spawn(async move {
        while let Some(terminal_id) = detach_rx.recv().await {
            tracing::warn!("tmux attach died for terminal {}, attempting re-attach", terminal_id);
            // Brief delay to let the old process fully exit
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            const MAX_RETRIES: u32 = 3;
            for attempt in 1..=MAX_RETRIES {
                match pty_for_reattach.reattach_tmux(&terminal_id) {
                    Ok(()) => {
                        tracing::info!("Re-attached terminal {} (attempt {})", terminal_id, attempt);
                        break;
                    }
                    Err(e) => {
                        tracing::error!(
                            "Re-attach failed for terminal {} (attempt {}/{}): {}",
                            terminal_id, attempt, MAX_RETRIES, e
                        );
                        if attempt < MAX_RETRIES {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
    });

    let conn = hub_conn::HubConnection {
        machine_id,
        machine_name,
        machine_secret,
        hub_url: ws_url,
        pty_manager,
    };

    conn.run().await;
}

fn cmd_status() {
    let config_path = config::config_path();
    let config_exists = config_path.exists();

    println!("Config file: {} ({})", config_path.display(), if config_exists { "exists" } else { "not found" });

    match config::load_config() {
        Ok(cfg) => {
            println!("Machine ID:  {}", cfg.machine_id);
            println!("Hub URL:     {}", cfg.hub_url);
        }
        Err(_) => {
            println!("Machine ID:  (not registered)");
            println!("Hub URL:     (not registered)");
        }
    }

    match service::is_active() {
        Some(status) => println!("Service:     {}", status),
        None => println!("Service:     not installed"),
    }
}

fn cmd_service_install(no_auto_upgrade: bool) {
    // Require registration before installing the service
    let config = match config::load_config() {
        Ok(c) => c,
        Err(_) => {
            eprintln!("Not registered. Run \"webmux-node register\" first.");
            std::process::exit(1);
        }
    };

    let machine_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| config.machine_id.clone());

    match service::install(&machine_name, no_auto_upgrade) {
        Ok(()) => {
            println!();
            println!("Service installed and started!");
            println!("It will auto-start on boot.");
            println!();
            println!("Useful commands:");
            if cfg!(target_os = "macos") {
                println!("  launchctl list com.webmux.node");
                println!("  tail -f ~/Library/Logs/webmux/stderr.log");
            } else {
                println!("  systemctl --user status {}", service::SERVICE_NAME);
                println!("  journalctl --user -u {} -f", service::SERVICE_NAME);
            }
            println!("  webmux-node service uninstall");
        }
        Err(e) => {
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            eprintln!("Failed to install service: {}", e);
            eprintln!("Service file path: {}", service::service_file_path(&home));
            std::process::exit(1);
        }
    }
}

fn cmd_service_uninstall() {
    match service::uninstall() {
        Ok(()) => {
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            println!("Service file removed: {}", service::service_file_path(&home));
            println!("Service uninstalled.");
        }
        Err(e) => {
            eprintln!("Failed to uninstall service: {}", e);
            std::process::exit(1);
        }
    }
}
