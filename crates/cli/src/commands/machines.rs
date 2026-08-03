use std::collections::HashMap;

use crate::client::HubClient;
use crate::resolve::short_id;
use crate::CliError;

/// List online machines. The hub only returns online machines, so every
/// listed machine is reachable; terminal counts come from /api/terminals.
pub async fn run(client: &HubClient, json: bool) -> Result<(), CliError> {
    let machines = client.machines().await?;
    if json {
        println!("{}", super::json_pretty(&machines)?);
        return Ok(());
    }

    let terminals = client.terminals().await?;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for terminal in &terminals {
        *counts.entry(terminal.machine_id.as_str()).or_default() += 1;
    }

    if machines.is_empty() {
        println!("(no machines online)");
        return Ok(());
    }
    println!("{:<10} {:<24} {:>5} {:<8}", "ID", "NAME", "TERMS", "STATUS");
    for machine in &machines {
        let count = counts.get(machine.id.as_str()).copied().unwrap_or(0);
        println!(
            "{:<10} {:<24} {:>5} {:<8}",
            short_id(&machine.id),
            machine.name,
            count,
            "online"
        );
    }
    Ok(())
}
