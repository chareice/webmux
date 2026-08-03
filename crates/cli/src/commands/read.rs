use std::time::Duration;

use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::CliError;

/// Attach as a read-only watcher and print the reconstructed screen.
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    lines: Option<usize>,
    json: bool,
    quiet_ms: u64,
    timeout_secs: u64,
) -> Result<(), CliError> {
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

    let screen = attach::capture(&target, Duration::from_millis(quiet_ms), timeout).await?;
    let trimmed = attach::trim_trailing_blank_lines(&screen.contents());

    if json {
        let output = serde_json::json!({
            "id": terminal.id,
            "cols": cols,
            "rows": rows,
            "screen": trimmed,
        });
        println!("{}", super::json_pretty(&output)?);
    } else {
        let output = match lines {
            Some(count) => attach::last_n_lines(&trimmed, count),
            None => trimmed,
        };
        println!("{output}");
    }
    Ok(())
}
