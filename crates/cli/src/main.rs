mod attach;
mod client;
mod commands;
mod config;
mod keys;
mod resolve;

use clap::{ArgGroup, Parser, Subcommand};

/// Error type for the whole CLI. Every variant maps to an exit code:
/// 0 = ok, 1 = wait timeout, 2 = usage/config/network/protocol error.
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("{0}")]
    Usage(String),
    #[error("{0}")]
    Config(String),
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Protocol(String),
    #[error("wait timed out")]
    WaitTimeout,
}

impl CliError {
    fn exit_code(&self) -> i32 {
        match self {
            CliError::WaitTimeout => 1,
            _ => 2,
        }
    }
}

#[derive(Parser)]
#[command(
    name = "webmux",
    version,
    about = "webmux CLI — remote `tmux send-keys` + `capture-pane` through the hub"
)]
struct Cli {
    /// Verbose debug logging to stderr
    #[arg(short, long, global = true)]
    verbose: bool,
    /// Hub URL (or WEBMUX_URL / url in ~/.config/webmux/config.toml)
    #[arg(long, global = true)]
    url: Option<String>,
    /// API token (or WEBMUX_TOKEN / token in ~/.config/webmux/config.toml)
    #[arg(long, global = true)]
    token: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List online machines
    Machines {
        /// Machine-readable JSON on stdout
        #[arg(long)]
        json: bool,
    },
    /// List terminals
    Ls {
        /// Filter to one machine (id or unique prefix)
        #[arg(long)]
        machine: Option<String>,
        /// Machine-readable JSON on stdout
        #[arg(long)]
        json: bool,
    },
    /// Open a new terminal on a machine
    Open {
        /// Machine id or unique prefix
        machine: String,
        /// Working directory for the new terminal
        #[arg(long)]
        cwd: String,
        /// Shell command to run at startup
        #[arg(long)]
        cmd: Option<String>,
        /// Existing workspace group name (groups are not auto-created)
        #[arg(long)]
        group: Option<String>,
        #[arg(long)]
        cols: Option<u16>,
        #[arg(long)]
        rows: Option<u16>,
        /// Machine-readable JSON on stdout
        #[arg(long)]
        json: bool,
    },
    /// Capture the current screen of a terminal, or of every terminal with --all (read-only watcher)
    Read {
        /// Terminal id or unique prefix
        term: Option<String>,
        /// Capture every terminal in one batch (use --machine to filter)
        #[arg(long, conflicts_with = "term")]
        all: bool,
        /// Batch only: only terminals on this machine (id or unique prefix)
        #[arg(long, requires = "all")]
        machine: Option<String>,
        /// Print only the last N lines (after trimming blank lines)
        #[arg(long)]
        lines: Option<usize>,
        /// Machine-readable JSON on stdout
        #[arg(long)]
        json: bool,
        /// Stop capturing after this many ms without output
        #[arg(long, default_value = "500")]
        quiet_ms: u64,
        /// Total capture timeout in seconds, 0 = forever
        #[arg(long, default_value = "10s", value_parser = attach::parse_secs)]
        timeout: u64,
        /// Batch only: max terminals captured concurrently
        #[arg(long, default_value = "8", requires = "all")]
        concurrency: usize,
    },
    /// Send text to a terminal (claims control, last-writer-wins)
    Send {
        /// Terminal id or unique prefix
        term: String,
        /// Text to send (joined with single spaces)
        #[arg(required = true)]
        text: Vec<String>,
        /// Do not append Enter (\\r)
        #[arg(long)]
        no_enter: bool,
    },
    /// Send key presses to a terminal (claims control, last-writer-wins)
    Key {
        /// Terminal id or unique prefix
        term: String,
        /// Keyspecs: Enter, Esc, Tab, BTab, Space, Up|Down|Left|Right, Home,
        /// End, PgUp, PgDn, Del, Backspace, F1-F12, C-<letter>, C-[
        #[arg(required = true, value_name = "KEY")]
        keys: Vec<String>,
    },
    /// Wait for a pattern or silence on a terminal (read-only watcher)
    #[command(group(
        ArgGroup::new("condition")
            .args(["pattern", "silence"])
            .required(true)
            .multiple(true)
    ))]
    Wait {
        /// Terminal id or unique prefix
        term: String,
        /// Exit 0 when this regex matches the current screen
        #[arg(long)]
        pattern: Option<String>,
        /// Exit 0 after this many ms without output
        #[arg(long)]
        silence: Option<u64>,
        /// Give up after this many seconds (default 60, 0 = forever) -> exit 1
        #[arg(long, default_value = "60")]
        timeout: u64,
    },
    /// Kill a terminal
    Kill {
        /// Terminal id or unique prefix
        term: String,
        /// Do not ask for confirmation
        #[arg(long)]
        yes: bool,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    if cli.verbose {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(std::io::stderr)
            .init();
    }
    let code = match run(cli).await {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("error: {error}");
            error.exit_code()
        }
    };
    std::process::exit(code);
}

async fn run(cli: Cli) -> Result<(), CliError> {
    let file = config::load_config_file()?;
    let env_url = std::env::var("WEBMUX_URL").ok();
    let env_token = std::env::var("WEBMUX_TOKEN").ok();
    let resolved = config::resolve(
        cli.url.as_deref(),
        cli.token.as_deref(),
        env_url.as_deref(),
        env_token.as_deref(),
        file.as_ref(),
    )?;
    let hub_client = client::HubClient::new(&resolved)?;

    match cli.command {
        Commands::Machines { json } => commands::machines::run(&hub_client, json).await,
        Commands::Ls { machine, json } => commands::ls::run(&hub_client, machine, json).await,
        Commands::Open {
            machine,
            cwd,
            cmd,
            group,
            cols,
            rows,
            json,
        } => {
            let options = commands::open::OpenOptions {
                cwd,
                cmd,
                group,
                cols,
                rows,
                json,
            };
            commands::open::run(&hub_client, &machine, options).await
        }
        Commands::Read {
            term,
            all,
            machine,
            lines,
            json,
            quiet_ms,
            timeout,
            concurrency,
        } => {
            let options = commands::read::ReadOptions {
                lines,
                json,
                quiet_ms,
                timeout_secs: timeout,
                machine,
                concurrency,
            };
            commands::read::run(&hub_client, &resolved, term.as_deref(), all, options).await
        }
        Commands::Send {
            term,
            text,
            no_enter,
        } => commands::send::run(&hub_client, &resolved, &term, text, no_enter).await,
        Commands::Key { term, keys } => {
            commands::key::run(&hub_client, &resolved, &term, keys).await
        }
        Commands::Wait {
            term,
            pattern,
            silence,
            timeout,
        } => commands::wait::run(&hub_client, &resolved, &term, pattern, silence, timeout).await,
        Commands::Kill { term, yes } => commands::kill::run(&hub_client, &term, yes).await,
    }
}
