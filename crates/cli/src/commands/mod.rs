pub mod key;
pub mod kill;
pub mod ls;
pub mod machines;
pub mod open;
pub mod read;
pub mod send;
pub mod wait;

use serde::Serialize;
use tc_protocol::TerminalInfo;

use crate::client::HubClient;
use crate::resolve::resolve_prefix;
use crate::CliError;

/// Fetch all terminals and resolve a user-supplied id/prefix against them.
pub async fn resolve_terminal(client: &HubClient, query: &str) -> Result<TerminalInfo, CliError> {
    let terminals = client.terminals().await?;
    resolve_prefix(query, &terminals, |terminal| terminal.id.as_str()).cloned()
}

pub fn json_pretty<T: Serialize>(value: &T) -> Result<String, CliError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| CliError::Protocol(format!("failed to serialize JSON: {error}")))
}

/// Screen dimensions for the vt100 emulator, with a 120x36 fallback when the
/// hub reports degenerate values.
pub fn terminal_dimensions(terminal: &TerminalInfo) -> (u16, u16) {
    let cols = if terminal.cols == 0 {
        120
    } else {
        terminal.cols
    };
    let rows = if terminal.rows == 0 {
        36
    } else {
        terminal.rows
    };
    (cols, rows)
}
