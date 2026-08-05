use crate::client::HubClient;
use crate::resolve::{resolve_prefix, short_id};
use crate::CliError;

/// List terminals, optionally filtered to one machine.
pub async fn run(client: &HubClient, machine: Option<String>, json: bool) -> Result<(), CliError> {
    let mut terminals = client.terminals().await?;
    if let Some(query) = &machine {
        let machines = client.machines().await?;
        let resolved = resolve_prefix(query, &machines, |m| m.id.as_str())?;
        terminals.retain(|terminal| terminal.machine_id == resolved.id);
    }

    if json {
        println!("{}", super::json_pretty(&terminals)?);
        return Ok(());
    }

    let group_names = super::fetch_group_names(client, &terminals).await?;

    println!(
        "{:<10} {:<24} {:<16} {:<32} {:>9} {:<9}",
        "ID", "TITLE", "GROUP", "CWD", "SIZE", "REACHABLE"
    );
    for terminal in &terminals {
        println!(
            "{:<10} {:<24} {:<16} {:<32} {:>9} {:<9}",
            short_id(&terminal.id),
            terminal.title,
            super::group_label(terminal, &group_names).unwrap_or_else(|| "-".to_string()),
            terminal.cwd,
            format!("{}x{}", terminal.cols, terminal.rows),
            if terminal.reachable { "yes" } else { "no" },
        );
    }
    Ok(())
}
