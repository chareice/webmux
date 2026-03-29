use crate::output::OutputMode;
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};
use webmux_shared::{
    CommandStatus, MessageRole, RunEvent, RunStatus, RunTimelineEventPayload, TodoEntryStatus,
};

/// Result of streaming a run to completion.
pub enum StreamResult {
    Success,
    Failed,
    Interrupted,
    ConnectionError(String),
}

/// Convert an HTTP(S) URL to a WebSocket URL.
fn to_ws_url(url: &str) -> String {
    if url.starts_with("https://") {
        format!("wss://{}", &url["https://".len()..])
    } else if url.starts_with("http://") {
        format!("ws://{}", &url["http://".len()..])
    } else {
        url.to_string()
    }
}

/// Connect to the server WebSocket and stream run events until completion.
pub async fn stream_run(
    server_url: &str,
    token: &str,
    run_id: &str,
    output_mode: OutputMode,
) -> StreamResult {
    let ws_base = to_ws_url(server_url);
    let ws_url = format!(
        "{}/ws/thread?token={}&threadId={}",
        ws_base, token, run_id
    );

    debug!("Connecting to WebSocket: {}", ws_url);

    let (ws_stream, _) = match tokio_tungstenite::connect_async(&ws_url).await {
        Ok(conn) => conn,
        Err(e) => {
            return StreamResult::ConnectionError(format!("WebSocket connection failed: {}", e));
        }
    };

    let (_write, mut read) = ws_stream.split();

    while let Some(msg_result) = read.next().await {
        let msg = match msg_result {
            Ok(msg) => msg,
            Err(e) => {
                return StreamResult::ConnectionError(format!("WebSocket read error: {}", e));
            }
        };

        match msg {
            Message::Text(text) => {
                let event: RunEvent = match serde_json::from_str(&text) {
                    Ok(e) => e,
                    Err(e) => {
                        debug!("Failed to parse RunEvent: {} — raw: {}", e, text);
                        continue;
                    }
                };

                match handle_event(&event, output_mode) {
                    EventAction::Continue => {}
                    EventAction::Finish(result) => return result,
                }
            }
            Message::Close(_) => {
                debug!("WebSocket closed by server");
                return StreamResult::ConnectionError("Connection closed by server".into());
            }
            _ => {
                // Ignore ping/pong/binary/frame control messages
            }
        }
    }

    // Stream ended without a terminal status
    StreamResult::ConnectionError("WebSocket stream ended unexpectedly".into())
}

enum EventAction {
    Continue,
    Finish(StreamResult),
}

fn handle_event(event: &RunEvent, mode: OutputMode) -> EventAction {
    match mode {
        OutputMode::Json => handle_event_json(event),
        OutputMode::Text => handle_event_text(event),
    }
}

// --- JSON output mode ---

fn handle_event_json(event: &RunEvent) -> EventAction {
    // Print every event as NDJSON, then check for terminal status.
    if let Ok(json) = serde_json::to_string(event) {
        println!("{}", json);
    }

    match event {
        RunEvent::RunStatus { run } => match run.status {
            RunStatus::Success => EventAction::Finish(StreamResult::Success),
            RunStatus::Failed => EventAction::Finish(StreamResult::Failed),
            RunStatus::Interrupted => EventAction::Finish(StreamResult::Interrupted),
            _ => EventAction::Continue,
        },
        _ => EventAction::Continue,
    }
}

// --- Text output mode ---

fn handle_event_text(event: &RunEvent) -> EventAction {
    match event {
        RunEvent::RunStatus { run } => match run.status {
            RunStatus::Success => {
                if let Some(summary) = &run.summary {
                    println!("\n{}", summary);
                }
                println!("\n--- Run completed successfully ---");
                EventAction::Finish(StreamResult::Success)
            }
            RunStatus::Failed => {
                if let Some(summary) = &run.summary {
                    eprintln!("\n{}", summary);
                }
                eprintln!("\n--- Run failed ---");
                EventAction::Finish(StreamResult::Failed)
            }
            RunStatus::Interrupted => {
                eprintln!("\n--- Run interrupted ---");
                EventAction::Finish(StreamResult::Interrupted)
            }
            RunStatus::Running => {
                debug!("Run is running...");
                EventAction::Continue
            }
            RunStatus::Starting => {
                println!("Starting...");
                EventAction::Continue
            }
            RunStatus::Queued => {
                println!("Queued...");
                EventAction::Continue
            }
        },

        RunEvent::RunItem { item, .. } => {
            print_timeline_event_text(&item.payload);
            EventAction::Continue
        }

        RunEvent::RunTurn { turn, .. } => {
            if turn.index > 0 {
                println!("\n━━━ Turn {} ━━━", turn.index + 1);
            }
            EventAction::Continue
        }

        // Ignore task-level and project-level events
        _ => {
            debug!("Ignoring non-run event");
            EventAction::Continue
        }
    }
}

fn print_timeline_event_text(payload: &RunTimelineEventPayload) {
    match payload {
        RunTimelineEventPayload::Message { role, text } => {
            let header = match role {
                MessageRole::Assistant => "── Assistant ──",
                MessageRole::User => "── User ──",
                MessageRole::System => "── System ──",
            };
            println!("\n{}", header);
            println!("{}", text);
        }

        RunTimelineEventPayload::Command {
            status,
            command,
            output,
            exit_code,
        } => match status {
            CommandStatus::Started => {
                println!("\n$ {}", command);
            }
            CommandStatus::Completed | CommandStatus::Failed => {
                if !output.is_empty() {
                    println!("{}", output);
                }
                if let Some(code) = exit_code {
                    if *code != 0 {
                        warn!("Command exited with code {}", code);
                    }
                }
            }
        },

        RunTimelineEventPayload::Activity {
            label, detail, ..
        } => {
            if let Some(detail) = detail {
                println!("● {} — {}", label, detail);
            } else {
                println!("● {}", label);
            }
        }

        RunTimelineEventPayload::Todo { items } => {
            println!();
            for entry in items {
                let marker = match entry.status {
                    TodoEntryStatus::Completed => "[x]",
                    TodoEntryStatus::InProgress => "[-]",
                    TodoEntryStatus::Pending => "[ ]",
                };
                println!("  {} {}", marker, entry.text);
            }
        }
    }
}
