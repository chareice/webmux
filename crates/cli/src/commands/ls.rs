use std::collections::{HashMap, HashSet};

use tc_protocol::TerminalInfo;

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

    let group_names = fetch_group_names(client, &terminals).await?;

    println!(
        "{:<10} {:<24} {:<16} {:<32} {:>9} {:<9}",
        "ID", "TITLE", "GROUP", "CWD", "SIZE", "REACHABLE"
    );
    for terminal in &terminals {
        println!(
            "{:<10} {:<24} {:<16} {:<32} {:>9} {:<9}",
            short_id(&terminal.id),
            terminal.title,
            group_label(terminal, &group_names),
            terminal.cwd,
            format!("{}x{}", terminal.cols, terminal.rows),
            if terminal.reachable { "yes" } else { "no" },
        );
    }
    Ok(())
}

/// Fetch workspace group names for every machine that has grouped terminals.
async fn fetch_group_names(
    client: &HubClient,
    terminals: &[TerminalInfo],
) -> Result<HashMap<String, String>, CliError> {
    let machine_ids: HashSet<&str> = terminals
        .iter()
        .filter(|terminal| terminal.workspace_group_id.is_some())
        .map(|terminal| terminal.machine_id.as_str())
        .collect();
    let mut names = HashMap::new();
    for machine_id in machine_ids {
        for group in client.workspace_groups(machine_id).await? {
            names.insert(group.id, group.name);
        }
    }
    Ok(names)
}

fn group_label(terminal: &TerminalInfo, names: &HashMap<String, String>) -> String {
    match terminal.workspace_group_id.as_deref() {
        None => "-".to_string(),
        Some(group_id) => names
            .get(group_id)
            .cloned()
            .unwrap_or_else(|| short_id(group_id).to_string()),
    }
}
