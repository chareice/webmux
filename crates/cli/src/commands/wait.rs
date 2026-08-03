use std::time::Duration;

use regex::Regex;

use crate::attach::{self, WaitOutcome};
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::CliError;

/// Wait for a screen pattern and/or output silence. Requires at least one
/// condition (enforced by clap). Timeout exits 1, WS close/error exits 2.
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    pattern: Option<String>,
    silence: Option<u64>,
    timeout_secs: u64,
) -> Result<(), CliError> {
    let pattern = pattern
        .map(|text| {
            Regex::new(&text)
                .map_err(|error| CliError::Usage(format!("invalid --pattern regex: {error}")))
        })
        .transpose()?;
    let terminal = super::resolve_terminal(client, term_query).await?;

    let (cols, rows) = super::terminal_dimensions(&terminal);
    let target = attach::Target {
        config,
        machine_id: &terminal.machine_id,
        terminal_id: &terminal.id,
        device_id: format!("cli-read-{}", std::process::id()),
        cols,
        rows,
    };
    let timeout = (timeout_secs > 0).then(|| Duration::from_secs(timeout_secs));

    let outcome = attach::wait_screen(
        &target,
        pattern,
        silence.map(Duration::from_millis),
        timeout,
    )
    .await?;

    match outcome {
        WaitOutcome::PatternMatched => println!("pattern matched"),
        WaitOutcome::SilenceReached => println!("silence reached"),
    }
    Ok(())
}
