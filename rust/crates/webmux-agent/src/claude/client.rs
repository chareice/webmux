use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use super::event::ClaudeMessage;
use webmux_shared::RunImageAttachmentUpload;

/// Options for spawning a Claude CLI subprocess.
pub struct ClaudeClientOptions {
    pub cwd: String,
    pub resume: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub attachments: Vec<RunImageAttachmentUpload>,
}

/// Handle returned from `start_claude`. Receives parsed events via channel.
pub struct ClaudeHandle {
    child: Option<Child>,
    pub rx: mpsc::Receiver<ClaudeStreamEvent>,
    /// Channel to write messages to the CLI's stdin (stream-json protocol).
    stdin_tx: Option<mpsc::UnboundedSender<String>>,
}

/// Events produced by the Claude subprocess.
pub enum ClaudeStreamEvent {
    /// A parsed JSONL message from stdout.
    Message(ClaudeMessage),
    /// The subprocess exited.
    Done,
    /// An error occurred.
    Error(String),
}

impl ClaudeHandle {
    /// Send an interrupt control request to the Claude process via stdin.
    ///
    /// Uses the SDK's native `control_request` protocol instead of OS signals.
    /// The CLI handles the interrupt internally and responds via stdout.
    pub fn interrupt(&mut self) {
        if let Some(tx) = &self.stdin_tx {
            let request_id = format!("{:x}", rand_id());
            let msg = serde_json::json!({
                "type": "control_request",
                "request_id": request_id,
                "request": { "subtype": "interrupt" }
            });
            let payload = format!("{}\n", serde_json::to_string(&msg).unwrap());
            if tx.send(payload).is_err() {
                warn!("failed to send interrupt: stdin channel closed");
            }
        }
    }

    /// Kill the subprocess.
    pub fn close(&mut self) {
        // Drop the stdin channel first so the writer task exits
        self.stdin_tx.take();
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
    }
}

impl Drop for ClaudeHandle {
    fn drop(&mut self) {
        self.close();
    }
}

/// Generate a simple random-ish ID for control request tracking.
fn rand_id() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    // Mix with a counter-like value for uniqueness within the same nanosecond
    nanos ^ (nanos >> 16)
}

/// Build the stdin payload as an SDKUserMessage for the stream-json protocol.
///
/// Always constructs a proper SDKUserMessage JSON object. When images are
/// present, they are sent as native image content blocks so they consume
/// vision tokens (~1600 per image) instead of raw base64 text tokens.
fn build_stream_json_payload(
    prompt: &str,
    attachments: &[RunImageAttachmentUpload],
) -> String {
    let mut content = Vec::new();
    for attachment in attachments {
        content.push(serde_json::json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": attachment.mime_type,
                "data": attachment.base64
            }
        }));
    }
    let trimmed = prompt.trim();
    if !trimmed.is_empty() {
        content.push(serde_json::json!({
            "type": "text",
            "text": trimmed
        }));
    }

    let message = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content
        },
        "parent_tool_use_id": null,
        "session_id": ""
    });

    format!("{}\n", serde_json::to_string(&message).unwrap())
}

/// Spawn the `claude` CLI process and return a handle.
///
/// The process uses `--input-format stream-json --output-format stream-json`
/// for bidirectional JSON communication. This enables the native SDK control
/// protocol: the handle can send `control_request` messages (like interrupt)
/// via stdin, and the CLI responds via stdout.
///
/// Stdin remains open for the lifetime of the handle so that control messages
/// can be sent at any time.
pub fn start_claude(
    prompt: &str,
    options: &ClaudeClientOptions,
) -> Result<ClaudeHandle, String> {
    let claude_bin = std::env::var("WEBMUX_CLAUDE_PATH")
        .unwrap_or_else(|_| "claude".to_string());

    let mut cmd = Command::new(&claude_bin);
    cmd.arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--input-format")
        .arg("stream-json")
        .arg("--dangerously-skip-permissions");

    cmd.current_dir(&options.cwd);

    if let Some(model) = &options.model {
        cmd.arg("--model").arg(model);
    }

    if let Some(resume) = &options.resume {
        cmd.arg("--resume").arg(resume);
    }

    if let Some(effort) = &options.effort {
        cmd.arg("--effort").arg(effort);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;

    // Set up a channel-backed stdin writer so we can send messages at any time.
    // The prompt is sent immediately; subsequent messages (like interrupt) can
    // be sent later via the channel.
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

    let payload = build_stream_json_payload(prompt, &options.attachments);
    // Enqueue the initial prompt — will be written by the stdin task below
    let _ = stdin_tx.send(payload);

    let mut stdin = child.stdin.take().expect("stdin is piped");
    tokio::spawn(async move {
        while let Some(msg) = stdin_rx.recv().await {
            if let Err(e) = stdin.write_all(msg.as_bytes()).await {
                warn!("failed to write to claude stdin: {e}");
                break;
            }
            if let Err(e) = stdin.flush().await {
                warn!("failed to flush claude stdin: {e}");
                break;
            }
        }
        // Channel closed — drop stdin to signal EOF to the CLI process
        drop(stdin);
    });

    // Read stderr in background (for diagnostics)
    let stderr = child.stderr.take().expect("stderr is piped");
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "claude_stderr", "{}", line);
        }
    });

    // Read stdout JSONL and parse
    let stdout = child.stdout.take().expect("stdout is piped");
    let (tx, rx) = mpsc::channel::<ClaudeStreamEvent>(256);

    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    // Skip control_response messages from the CLI — they are
                    // acknowledgements of our control_request messages (e.g.
                    // interrupt) and don't need to be forwarded.
                    if trimmed.contains("\"control_response\"") {
                        debug!(target: "claude_control", "control_response: {}", trimmed);
                        continue;
                    }
                    match serde_json::from_str::<ClaudeMessage>(trimmed) {
                        Ok(msg) => {
                            if tx.send(ClaudeStreamEvent::Message(msg)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            warn!("failed to parse claude JSONL: {e} — line: {trimmed}");
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tx
                        .send(ClaudeStreamEvent::Error(format!(
                            "failed to read claude stdout: {e}"
                        )))
                        .await;
                    break;
                }
            }
        }

        let _ = tx.send(ClaudeStreamEvent::Done).await;
    });

    Ok(ClaudeHandle {
        child: Some(child),
        rx,
        stdin_tx: Some(stdin_tx),
    })
}
