pub mod client;
pub mod commands;
pub mod config;
pub mod output;
pub mod stream;

use clap::{Parser, Subcommand};
use output::OutputMode;
use tracing_subscriber::EnvFilter;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(name = "webmux", about = "Webmux CLI — control AI coding agents", version = VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Save server URL and API token
    Login {
        #[arg(long)]
        server: String,
        #[arg(long)]
        token: String,
    },
    /// Show connection status
    Status,
    /// List agents
    Agents {
        #[arg(long, default_value = "text")]
        output: OutputFormat,
    },
    /// Start a run and stream results
    Run {
        /// Agent name or ID
        #[arg(long)]
        agent: String,
        /// Tool (claude or codex)
        #[arg(long, default_value = "claude")]
        tool: String,
        /// Repository path on agent
        #[arg(long)]
        repo: String,
        /// Prompt text
        #[arg(long, short)]
        prompt: Option<String>,
        /// Read prompt from file
        #[arg(long)]
        prompt_file: Option<String>,
        /// Output format
        #[arg(long, default_value = "text")]
        output: OutputFormat,
        /// Fire and forget (don't stream)
        #[arg(long)]
        no_wait: bool,
    },
    /// List threads
    Threads {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value = "text")]
        output: OutputFormat,
    },
    /// Thread operations
    Thread {
        #[command(subcommand)]
        command: ThreadCommands,
    },
    /// API token management
    Token {
        #[command(subcommand)]
        command: TokenCommands,
    },
}

#[derive(Subcommand)]
enum ThreadCommands {
    /// Show thread timeline
    Show {
        /// Thread ID
        id: String,
        #[arg(long, default_value = "text")]
        output: OutputFormat,
    },
}

#[derive(Subcommand)]
enum TokenCommands {
    /// Create a new API token
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        expires_in_days: Option<i64>,
    },
    /// List API tokens
    List,
    /// Revoke an API token
    Revoke {
        /// Token ID
        id: String,
    },
}

#[derive(Clone, clap::ValueEnum)]
pub enum OutputFormat {
    Text,
    Json,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Login { server, token } => {
            commands::login::cmd_login(&server, &token).await?;
        }
        Commands::Status => {
            let cfg = config::require_config();
            commands::status::cmd_status(&cfg).await?;
        }
        Commands::Agents { output } => {
            let cfg = config::require_config();
            commands::agents::cmd_agents(&cfg, OutputMode::from(&output)).await?;
        }
        Commands::Run {
            agent,
            tool,
            repo,
            prompt,
            prompt_file,
            output,
            no_wait,
        } => {
            let cfg = config::require_config();
            commands::run::cmd_run(
                &cfg,
                &agent,
                &tool,
                &repo,
                prompt.as_deref(),
                prompt_file.as_deref(),
                OutputMode::from(&output),
                no_wait,
            )
            .await?;
        }
        Commands::Threads { agent, output } => {
            let cfg = config::require_config();
            commands::threads::cmd_threads(&cfg, agent.as_deref(), OutputMode::from(&output))
                .await?;
        }
        Commands::Thread { command } => {
            let cfg = config::require_config();
            match command {
                ThreadCommands::Show { id, output } => {
                    commands::threads::cmd_thread_show(&cfg, &id, OutputMode::from(&output))
                        .await?;
                }
            }
        }
        Commands::Token { command } => {
            let cfg = config::require_config();
            match command {
                TokenCommands::Create {
                    name,
                    expires_in_days,
                } => {
                    commands::token::cmd_token_create(&cfg, &name, expires_in_days).await?;
                }
                TokenCommands::List => {
                    commands::token::cmd_token_list(&cfg).await?;
                }
                TokenCommands::Revoke { id } => {
                    commands::token::cmd_token_revoke(&cfg, &id).await?;
                }
            }
        }
    }

    Ok(())
}
