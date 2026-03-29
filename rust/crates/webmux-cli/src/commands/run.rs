use std::io::{self, IsTerminal, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context};

use crate::client::WebmuxClient;
use crate::config::Config;
use crate::output::OutputMode;
use crate::stream::{self, StreamResult};
use webmux_shared::{
    AgentInfo, AgentListResponse, AgentStatus, RunDetailResponse, RunTool, StartRunRequest,
};

/// Check if a string looks like a UUID.
fn is_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

/// Parse a tool name string into a RunTool enum.
fn parse_tool(s: &str) -> anyhow::Result<RunTool> {
    match s.to_lowercase().as_str() {
        "claude" => Ok(RunTool::Claude),
        "codex" => Ok(RunTool::Codex),
        other => bail!("Unknown tool '{}'. Supported: claude, codex", other),
    }
}

/// Resolve the prompt from --prompt, --prompt-file, or stdin.
fn resolve_prompt(prompt: Option<&str>, prompt_file: Option<&str>) -> anyhow::Result<String> {
    if let Some(text) = prompt {
        return Ok(text.to_string());
    }

    if let Some(path) = prompt_file {
        let content =
            std::fs::read_to_string(path).with_context(|| format!("Failed to read {}", path))?;
        return Ok(content);
    }

    // Try reading from stdin if it's not a TTY (piped input)
    let stdin = io::stdin();
    if !stdin.is_terminal() {
        let mut buf = String::new();
        stdin
            .lock()
            .read_to_string(&mut buf)
            .context("Failed to read from stdin")?;
        if !buf.trim().is_empty() {
            return Ok(buf);
        }
    }

    bail!("No prompt provided. Use --prompt, --prompt-file, or pipe to stdin.")
}

/// Resolve an agent identifier (name or UUID) to an AgentInfo.
async fn resolve_agent(client: &WebmuxClient, agent: &str) -> anyhow::Result<AgentInfo> {
    if is_uuid(agent) {
        // If it looks like a UUID, fetch the agent list and find by ID
        let resp: AgentListResponse = client
            .get("/api/agents")
            .await
            .context("Failed to list agents")?;
        let found = resp.agents.into_iter().find(|a| a.id == agent);
        match found {
            Some(a) => Ok(a),
            None => bail!("Agent with ID '{}' not found", agent),
        }
    } else {
        // Find by name (case-insensitive)
        let resp: AgentListResponse = client
            .get("/api/agents")
            .await
            .context("Failed to list agents")?;
        let needle = agent.to_lowercase();
        let found = resp
            .agents
            .into_iter()
            .find(|a| a.name.to_lowercase() == needle);
        match found {
            Some(a) => Ok(a),
            None => bail!("Agent '{}' not found", agent),
        }
    }
}

pub async fn cmd_run(
    config: &Config,
    agent: &str,
    tool: &str,
    repo: &str,
    prompt: Option<&str>,
    prompt_file: Option<&str>,
    output_mode: OutputMode,
    no_wait: bool,
) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    // 1. Resolve prompt
    let prompt_text = resolve_prompt(prompt, prompt_file)?;

    // 2. Parse tool
    let run_tool = parse_tool(tool)?;

    // 3. Resolve agent
    let agent_info = resolve_agent(&client, agent).await?;

    match agent_info.status {
        AgentStatus::Offline => {
            bail!(
                "Agent '{}' is offline. Cannot start a run.",
                agent_info.name
            );
        }
        AgentStatus::Online => {}
    }

    // 4. Start run
    let request = StartRunRequest {
        tool: run_tool,
        repo_path: repo.to_string(),
        prompt: prompt_text,
        existing_session_id: None,
        attachments: None,
        options: None,
    };

    let resp: RunDetailResponse = client
        .post(
            &format!("/api/agents/{}/threads", agent_info.id),
            &request,
        )
        .await
        .context("Failed to start run")?;

    let run_id = resp.run.id;

    // 5. No-wait mode: just print the run ID and exit
    if no_wait {
        println!("{}", run_id);
        return Ok(());
    }

    // 6. Set up Ctrl+C handler to send interrupt
    let interrupted = Arc::new(AtomicBool::new(false));
    {
        let interrupted = interrupted.clone();
        let interrupt_url = format!(
            "/api/agents/{}/threads/{}/interrupt",
            agent_info.id, run_id
        );
        let interrupt_client = WebmuxClient::new(config);

        ctrlc::set_handler(move || {
            if interrupted.swap(true, Ordering::SeqCst) {
                // Second Ctrl+C: force exit
                eprintln!("\nForce exit.");
                std::process::exit(130);
            }
            eprintln!("\nInterrupting run... (press Ctrl+C again to force exit)");

            // Send interrupt request in a blocking fashion
            let url = interrupt_url.clone();
            let client = WebmuxClient::new(&Config {
                server_url: interrupt_client.base_url().to_string(),
                api_token: interrupt_client.token().to_string(),
            });
            // Spawn a blocking thread to send the interrupt
            std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                let _ = rt.block_on(async {
                    // POST with empty JSON body
                    let result: Result<serde_json::Value, _> =
                        client.post(&url, &serde_json::json!({})).await;
                    if let Err(e) = result {
                        eprintln!("Failed to send interrupt: {}", e);
                    }
                });
            });
        })
        .context("Failed to set Ctrl+C handler")?;
    }

    // 7. Stream run events
    match output_mode {
        OutputMode::Text => {
            eprintln!(
                "Run started: {} (agent: {})",
                run_id, agent_info.name
            );
        }
        OutputMode::Json => {}
    }

    let result = stream::stream_run(
        client.base_url(),
        client.token(),
        &run_id,
        output_mode,
    )
    .await;

    // 8. Exit code based on result
    match result {
        StreamResult::Success => std::process::exit(0),
        StreamResult::Failed => std::process::exit(1),
        StreamResult::Interrupted => std::process::exit(2),
        StreamResult::ConnectionError(msg) => {
            eprintln!("Connection error: {}", msg);
            std::process::exit(3);
        }
    }
}
