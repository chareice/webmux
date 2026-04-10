mod config;
mod hub_conn;
mod pty;

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

    let register_url = format!("{}/api/machines/register", hub_url.trim_end_matches('/'));

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
}

/// Convert an HTTP hub URL to its WebSocket machine endpoint.
/// e.g. http://localhost:3000 -> ws://localhost:3000/ws/machine
///      https://hub.example.com -> wss://hub.example.com/ws/machine
fn build_ws_url(hub_url: &str) -> String {
    let base = hub_url.trim_end_matches('/');
    let ws_base = if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else if base.starts_with("http://") {
        base.replacen("http://", "ws://", 1)
    } else {
        // Already a ws:// URL or something else, use as-is
        base.to_string()
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

    let pty_manager = Arc::new(pty::PtyManager::new());

    let conn = hub_conn::HubConnection {
        machine_id,
        machine_name,
        machine_secret,
        hub_url: ws_url,
        pty_manager,
    };

    conn.run().await;
}
