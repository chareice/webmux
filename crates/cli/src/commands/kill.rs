use std::io::{IsTerminal, Write};

use tc_protocol::TerminalInfo;

use crate::client::HubClient;
use crate::resolve::short_id;
use crate::CliError;

/// Delete a terminal, asking for confirmation on a tty unless --yes.
pub async fn run(client: &HubClient, term_query: &str, yes: bool) -> Result<(), CliError> {
    let terminal = super::resolve_terminal(client, term_query).await?;

    if !yes && std::io::stdin().is_terminal() && !confirm(&terminal)? {
        println!("aborted");
        return Ok(());
    }

    // Deleting a terminal is gated on the control lease; claim it first.
    client.claim_control(&terminal.machine_id).await?;
    client
        .delete_terminal(&terminal.machine_id, &terminal.id)
        .await?;
    println!("killed {}", terminal.id);
    Ok(())
}

fn confirm(terminal: &TerminalInfo) -> Result<bool, CliError> {
    eprint!(
        "Kill terminal {} ({})? [y/N] ",
        short_id(&terminal.id),
        terminal.title
    );
    std::io::stderr()
        .flush()
        .map_err(|error| CliError::Usage(format!("failed to prompt: {error}")))?;
    let mut answer = String::new();
    std::io::stdin()
        .read_line(&mut answer)
        .map_err(|error| CliError::Usage(format!("failed to read confirmation: {error}")))?;
    let answer = answer.trim().to_lowercase();
    Ok(answer == "y" || answer == "yes")
}
