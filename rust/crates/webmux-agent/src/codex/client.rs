use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use super::event::CodexEvent;

/// Options for spawning a Codex CLI subprocess.
pub struct CodexClientOptions {
    pub working_directory: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub resume_thread_id: Option<String>,
}

/// Events produced by the Codex subprocess.
pub enum CodexStreamEvent {
    /// A parsed JSONL event from stdout.
    Event(CodexEvent),
    /// The subprocess exited.
    Done,
    /// An error occurred.
    Error(String),
}

/// Handle returned from `start_codex`. Receives parsed events via channel.
pub struct CodexHandle {
    child: Option<Child>,
    pub rx: mpsc::Receiver<CodexStreamEvent>,
}

impl CodexHandle {
    /// Kill the subprocess (abort).
    pub fn abort(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
    }
}

impl Drop for CodexHandle {
    fn drop(&mut self) {
        self.abort();
    }
}

/// Spawn the `codex` CLI process and return a handle.
///
/// For a new thread: `codex exec --experimental-json ...`
/// For resume: `codex exec --experimental-json resume <thread_id> ...`
///
/// The process emits JSONL events on stdout. We read those lines, parse them
/// as `CodexEvent`, and forward them over a channel.
pub fn start_codex(
    prompt: &str,
    _image_paths: &[PathBuf],
    options: &CodexClientOptions,
) -> Result<CodexHandle, String> {
    let codex_bin = std::env::var("WEBMUX_CODEX_PATH")
        .unwrap_or_else(|_| "codex".to_string());

    let mut cmd = Command::new(&codex_bin);
    cmd.arg("exec").arg("--experimental-json");

    if let Some(ref resume_id) = options.resume_thread_id {
        cmd.arg("resume").arg(resume_id);
    }

    cmd.arg("--sandbox")
        .arg("workspace-write")
        .arg("--skip-git-repo-check")
        .arg("--dangerously-bypass-approvals-and-sandbox")
        .arg("-")
        .arg("--cd")
        .arg(&options.working_directory);

    if let Some(ref model) = options.model {
        cmd.arg("--model").arg(model);
    }

    if let Some(ref effort) = options.reasoning_effort {
        cmd.arg("--reasoning-effort").arg(effort);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn codex: {e}"))?;

    // Write prompt to stdin, then close
    let prompt_owned = prompt.to_string();
    let mut stdin = child.stdin.take().expect("stdin is piped");
    tokio::spawn(async move {
        if let Err(e) = stdin.write_all(prompt_owned.as_bytes()).await {
            warn!("failed to write prompt to codex stdin: {e}");
        }
        drop(stdin);
    });

    // Read stderr in background
    let stderr = child.stderr.take().expect("stderr is piped");
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "codex_stderr", "{}", line);
        }
    });

    // Read stdout JSONL and parse
    let stdout = child.stdout.take().expect("stdout is piped");
    let (tx, rx) = mpsc::channel::<CodexStreamEvent>(256);

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
                    match serde_json::from_str::<CodexEvent>(trimmed) {
                        Ok(event) => {
                            if tx.send(CodexStreamEvent::Event(event)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            warn!("failed to parse codex JSONL: {e} — line: {trimmed}");
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tx
                        .send(CodexStreamEvent::Error(format!(
                            "failed to read codex stdout: {e}"
                        )))
                        .await;
                    break;
                }
            }
        }

        let _ = tx.send(CodexStreamEvent::Done).await;
    });

    Ok(CodexHandle {
        child: Some(child),
        rx,
    })
}
