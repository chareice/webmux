use crate::client::WebmuxClient;
use crate::config::Config;
use crate::output::OutputMode;
use webmux_shared::{AgentListResponse, AgentStatus};

fn relative_time(timestamp_secs: f64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let diff_secs = (now - timestamp_secs).max(0.0) as u64;
    if diff_secs < 60 {
        format!("{}s ago", diff_secs)
    } else if diff_secs < 3600 {
        format!("{}m ago", diff_secs / 60)
    } else if diff_secs < 86400 {
        format!("{}h ago", diff_secs / 3600)
    } else {
        format!("{}d ago", diff_secs / 86400)
    }
}

pub async fn cmd_nodes(config: &Config, output: OutputMode) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    let resp = match client.get::<AgentListResponse>("/api/agents").await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    match output {
        OutputMode::Json => {
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
        OutputMode::Text => {
            if resp.agents.is_empty() {
                println!("No nodes found.");
                return Ok(());
            }

            // Calculate column widths
            let id_w = resp.agents.iter().map(|a| a.id.len()).max().unwrap_or(2).max(2);
            let name_w = resp.agents.iter().map(|a| a.name.len()).max().unwrap_or(4).max(4);

            println!(
                "{:<id_w$}  {:<name_w$}  {:<8}  {}",
                "ID", "NAME", "STATUS", "LAST SEEN",
                id_w = id_w, name_w = name_w,
            );

            for agent in &resp.agents {
                let status_str = match agent.status {
                    AgentStatus::Online => "online",
                    AgentStatus::Offline => "offline",
                };
                let last_seen = agent
                    .last_seen_at
                    .map(relative_time)
                    .unwrap_or_else(|| "-".to_string());

                println!(
                    "{:<id_w$}  {:<name_w$}  {:<8}  {}",
                    agent.id, agent.name, status_str, last_seen,
                    id_w = id_w, name_w = name_w,
                );
            }
        }
    }

    Ok(())
}
