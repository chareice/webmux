use std::time::Duration;

use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::CliError;

/// Options for `read`, shared by the single-terminal and `--all` batch modes.
pub struct ReadOptions {
    pub lines: Option<usize>,
    pub json: bool,
    pub quiet_ms: u64,
    pub timeout_secs: u64,
    /// Batch only: only terminals on this machine (id or unique prefix).
    pub machine: Option<String>,
    /// Batch only: max terminals captured concurrently.
    pub concurrency: usize,
    /// Batch JSON only: also emit unreachable terminals as error entries.
    pub include_unreachable: bool,
}

/// Capture one terminal's screen, or every terminal in batch mode (`--all`).
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term: Option<&str>,
    all: bool,
    options: ReadOptions,
) -> Result<(), CliError> {
    if all {
        return super::read_all::run(client, config, options).await;
    }
    let Some(term_query) = term else {
        return Err(CliError::Usage(
            "read requires a terminal id (or --all for a batch capture)".to_string(),
        ));
    };
    capture_one(client, config, term_query, &options).await
}

/// Attach as a read-only watcher and print the reconstructed screen.
async fn capture_one(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    options: &ReadOptions,
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
    let timeout = (options.timeout_secs > 0).then(|| Duration::from_secs(options.timeout_secs));
    let quiet = Duration::from_millis(options.quiet_ms);

    let report = attach::capture(&target, quiet, timeout).await?;
    let sanitized = attach::sanitize_screen(&report.screen.contents());
    let trimmed = attach::trim_trailing_blank_lines(&sanitized);
    let (screen, lines_total, truncated) = attach::apply_lines(&trimmed, options.lines);

    if options.json {
        let output = serde_json::json!({
            "id": terminal.id,
            "cols": cols,
            "rows": rows,
            "screen": screen,
            "lines_total": lines_total,
            "truncated": truncated,
            "activity": attach::classify_activity(report.end_reason, report.last_byte_age_ms, quiet),
            "idle_ms": report.last_byte_age_ms,
        });
        super::out_line(&super::json_pretty(&output)?);
    } else {
        super::out_line(&screen);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{run, ReadOptions};
    use crate::client::HubClient;
    use crate::config::ResolvedConfig;
    use crate::CliError;

    fn options() -> ReadOptions {
        ReadOptions {
            lines: None,
            json: false,
            quiet_ms: 500,
            timeout_secs: 10,
            machine: None,
            concurrency: 8,
            include_unreachable: false,
        }
    }

    #[tokio::test]
    async fn neither_term_nor_all_is_a_usage_error() {
        let config = ResolvedConfig {
            url: "http://localhost:1".to_string(),
            token: "token".to_string(),
        };
        let client = HubClient::new(&config).unwrap();
        let error = run(&client, &config, None, false, options())
            .await
            .unwrap_err();
        assert!(matches!(error, CliError::Usage(_)), "{error}");
    }
}
