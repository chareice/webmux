use crate::client::WebmuxClient;
use crate::config::Config;
use crate::output::OutputMode;
use webmux_shared::{
    CommandStatus, MessageRole, RunDetailResponse, RunListResponse, RunStatus,
    RunTimelineEventPayload,
};

fn relative_time(timestamp_ms: f64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let diff_secs = ((now - timestamp_ms) / 1000.0) as u64;
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

fn status_str(s: &RunStatus) -> &'static str {
    match s {
        RunStatus::Queued => "queued",
        RunStatus::Starting => "starting",
        RunStatus::Running => "running",
        RunStatus::Success => "success",
        RunStatus::Failed => "failed",
        RunStatus::Interrupted => "interrupted",
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    // Replace newlines with spaces for single-line display
    let s = s.replace('\n', " ");
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_len {
        s.to_string()
    } else {
        let truncated: String = chars[..max_len.saturating_sub(3)].iter().collect();
        format!("{}...", truncated)
    }
}

pub async fn cmd_threads(
    config: &Config,
    node: Option<&str>,
    output: OutputMode,
) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    let path = match node {
        Some(id) => format!("/api/agents/{}/threads", id),
        None => "/api/threads".to_string(),
    };

    let resp = match client.get::<RunListResponse>(&path).await {
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
            if resp.runs.is_empty() {
                println!("No threads found.");
                return Ok(());
            }

            // Fixed-width columns for readability
            println!(
                "{:<36}  {:<8}  {:<20}  {:<12}  {:<10}  {}",
                "ID", "TOOL", "REPO", "STATUS", "CREATED", "SUMMARY"
            );

            for run in &resp.runs {
                let tool_str = format!("{:?}", run.tool).to_lowercase();
                let summary = run
                    .summary
                    .as_deref()
                    .map(|s| truncate(s, 40))
                    .unwrap_or_else(|| "-".to_string());
                let created = relative_time(run.created_at);

                println!(
                    "{:<36}  {:<8}  {:<20}  {:<12}  {:<10}  {}",
                    run.id,
                    tool_str,
                    truncate(&run.repo_path, 20),
                    status_str(&run.status),
                    created,
                    summary,
                );
            }
        }
    }

    Ok(())
}

pub async fn cmd_thread_show(
    config: &Config,
    id: &str,
    output: OutputMode,
) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    // First find the run to get agent_id
    let list_resp = match client.get::<RunListResponse>("/api/threads").await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    let run_summary = list_resp.runs.iter().find(|r| r.id == id);
    let agent_id = match run_summary {
        Some(r) => r.agent_id.clone(),
        None => {
            eprintln!("Error: thread {} not found", id);
            std::process::exit(1);
        }
    };

    // Fetch full thread detail
    let detail_path = format!("/api/agents/{}/threads/{}", agent_id, id);
    let detail = match client.get::<RunDetailResponse>(&detail_path).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    match output {
        OutputMode::Json => {
            println!("{}", serde_json::to_string_pretty(&detail)?);
        }
        OutputMode::Text => {
            let run = &detail.run;
            let tool_str = format!("{:?}", run.tool).to_lowercase();
            println!("Thread:  {}", run.id);
            println!("Tool:    {}", tool_str);
            println!("Repo:    {}", run.repo_path);
            println!("Status:  {}", status_str(&run.status));
            println!("Created: {}", relative_time(run.created_at));
            if let Some(ref summary) = run.summary {
                println!("Summary: {}", summary);
            }
            println!();

            for turn in &detail.turns {
                println!("--- Turn {} [{}] ---", turn.index, status_str(&turn.status));
                println!("  Prompt: {}", truncate(&turn.prompt, 80));
                println!();

                for item in &turn.items {
                    match &item.payload {
                        RunTimelineEventPayload::Message { role, text } => {
                            let role_label = match role {
                                MessageRole::Assistant => "assistant",
                                MessageRole::User => "user",
                                MessageRole::System => "system",
                            };
                            println!("  [{}] {}", role_label, text);
                        }
                        RunTimelineEventPayload::Command {
                            status,
                            command,
                            output: cmd_output,
                            exit_code,
                        } => {
                            let status_label = match status {
                                CommandStatus::Started => "running",
                                CommandStatus::Completed => "done",
                                CommandStatus::Failed => "failed",
                            };
                            print!("  $ {} ({})", command, status_label);
                            if let Some(code) = exit_code {
                                print!(" exit={}", code);
                            }
                            println!();
                            if !cmd_output.is_empty() {
                                // Print first few lines of output
                                for line in cmd_output.lines().take(5) {
                                    println!("    {}", line);
                                }
                                let total_lines = cmd_output.lines().count();
                                if total_lines > 5 {
                                    println!("    ... ({} more lines)", total_lines - 5);
                                }
                            }
                        }
                        RunTimelineEventPayload::Activity {
                            label, detail, ..
                        } => {
                            print!("  > {}", label);
                            if let Some(d) = detail {
                                print!(" — {}", d);
                            }
                            println!();
                        }
                        RunTimelineEventPayload::Todo { items } => {
                            println!("  TODO:");
                            for item in items {
                                let mark = match item.status {
                                    webmux_shared::TodoEntryStatus::Completed => "[x]",
                                    webmux_shared::TodoEntryStatus::InProgress => "[-]",
                                    webmux_shared::TodoEntryStatus::Pending => "[ ]",
                                };
                                println!("    {} {}", mark, item.text);
                            }
                        }
                    }
                }
                println!();
            }
        }
    }

    Ok(())
}
