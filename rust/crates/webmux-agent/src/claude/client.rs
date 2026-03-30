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
    /// Send SIGINT to the Claude process (interrupt).
    pub fn interrupt(&mut self) {
        #[cfg(unix)]
        {
            if let Some(child) = &self.child {
                if let Some(id) = child.id() {
                    // Safety: sending SIGINT to a known child process
                    unsafe {
                        libc::kill(id as libc::pid_t, libc::SIGINT);
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            // On non-unix, fall back to killing the process
            self.close();
        }
    }

    /// Kill the subprocess.
    pub fn close(&mut self) {
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

/// Build the stdin payload for the Claude CLI.
///
/// When images are present we construct an SDKUserMessage JSON object with
/// native image content blocks. The caller must also pass `--input-format
/// stream-json` so the CLI interprets it correctly. This way images are
/// tokenised as vision tokens (~1600 tokens per image) rather than as raw
/// base64 text (millions of tokens), avoiding "prompt is too long" errors.
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

    // NDJSON: one JSON object per line, then close stdin
    format!("{}\n", serde_json::to_string(&message).unwrap())
}

/// Spawn the `claude` CLI process and return a handle.
///
/// The process is started with `--print --output-format stream-json` so that
/// it emits one JSON object per line on stdout. We read those lines, parse
/// them as `ClaudeMessage`, and forward them over a channel.
///
/// When image attachments are present, `--input-format stream-json` is added
/// and the prompt is wrapped in an SDKUserMessage with native image content
/// blocks so that images consume vision tokens instead of text tokens.
pub fn start_claude(
    prompt: &str,
    options: &ClaudeClientOptions,
) -> Result<ClaudeHandle, String> {
    let claude_bin = std::env::var("WEBMUX_CLAUDE_PATH")
        .unwrap_or_else(|_| "claude".to_string());

    let has_images = !options.attachments.is_empty();

    let mut cmd = Command::new(&claude_bin);
    cmd.arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--dangerously-skip-permissions");

    // Use stream-json input when images are present so they are sent as
    // native image content blocks instead of base64 text in the prompt.
    if has_images {
        cmd.arg("--input-format").arg("stream-json");
    }

    // Set working directory via process cwd, not CLI flag
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

    // Write prompt to stdin. When images are present, send a structured
    // SDKUserMessage; otherwise send plain text.
    let payload = if has_images {
        build_stream_json_payload(prompt, &options.attachments)
    } else {
        prompt.to_string()
    };
    let mut stdin = child.stdin.take().expect("stdin is piped");
    tokio::spawn(async move {
        if let Err(e) = stdin.write_all(payload.as_bytes()).await {
            warn!("failed to write prompt to claude stdin: {e}");
        }
        drop(stdin); // close stdin
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
    })
}

