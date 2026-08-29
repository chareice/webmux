//! ACP (Agent Client Protocol) client for agent sessions.
//!
//! Each agent session spawns one child process (command per agent kind,
//! overridable via `acp_agents` in machine.json) speaking ndjson JSON-RPC on
//! stdio. This module normalizes the agent-specific wire format into
//! `AgentEvent`s and per-session state updates that are forwarded to the hub.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tc_protocol::{AgentEvent, AgentKind, AgentQuestionOption, AgentSessionStatus, MachineToHub};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::mpsc;

/// initialize/session-new/session-load must answer within this window or the
/// session fails with an Error event.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
/// tool_call_update content is serialized into the event; cap it so a chatty
/// tool can't flood the hub's event log.
const TOOL_CALL_CONTENT_CAP: usize = 8 * 1024;

/// Default spawn commands per agent kind. Every entry is an argv vector —
/// agents are never spawned through a shell.
pub fn default_agent_commands() -> HashMap<String, Vec<String>> {
    HashMap::from([
        ("kimi".to_string(), vec!["kimi".to_string(), "acp".to_string()]),
        (
            "grok".to_string(),
            vec!["grok".to_string(), "agent".to_string(), "stdio".to_string()],
        ),
        (
            "claude".to_string(),
            vec![
                "npx".to_string(),
                "--yes".to_string(),
                "@zed-industries/claude-code-acp".to_string(),
            ],
        ),
        (
            "codex".to_string(),
            vec![
                "npx".to_string(),
                "--yes".to_string(),
                "@zed-industries/codex-acp".to_string(),
            ],
        ),
    ])
}

fn agent_kind_key(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Grok => "grok",
        AgentKind::Kimi => "kimi",
    }
}

/// Resolve the argv for an agent kind: machine.json override first, built-in
/// default otherwise.
pub fn resolve_agent_command(
    overrides: &HashMap<String, Vec<String>>,
    kind: AgentKind,
) -> Vec<String> {
    let defaults = default_agent_commands();
    overrides
        .get(agent_kind_key(kind))
        .or_else(|| defaults.get(agent_kind_key(kind)))
        .cloned()
        .expect("every agent kind has a default command")
}

enum SessionCommand {
    Prompt {
        text: String,
    },
    Answer {
        request_id: String,
        option_id: Option<String>,
        text: Option<String>,
    },
    Cancel,
    Kill,
}

/// Everything the session actor reacts to: hub commands, child stdout lines,
/// child exit, and handshake watchdogs.
enum ActorMsg {
    Command(SessionCommand),
    Line(String),
    Eof(String),
    HandshakeTimeout(u64),
}

struct AcpSessionHandle {
    cmd_tx: mpsc::Sender<SessionCommand>,
    ended: Arc<AtomicBool>,
}

/// Registry of live agent sessions for one hub connection. Agent processes
/// are not tmux-backed: they die with the machine (and with a dropped hub
/// connection); resume on the hub side covers recovery.
pub struct AcpManager {
    overrides: HashMap<String, Vec<String>>,
    sessions: std::sync::Mutex<HashMap<String, AcpSessionHandle>>,
    outbound: mpsc::Sender<MachineToHub>,
}

impl AcpManager {
    pub fn new(overrides: HashMap<String, Vec<String>>, outbound: mpsc::Sender<MachineToHub>) -> Self {
        Self {
            overrides,
            sessions: std::sync::Mutex::new(HashMap::new()),
            outbound,
        }
    }

    pub async fn start_session(
        &self,
        session_id: String,
        agent_kind: AgentKind,
        cwd: String,
        auto_run: bool,
        resume_acp_session_id: Option<String>,
    ) {
        // A stale handle (session already running, e.g. duplicate start) is
        // replaced: kill the old process before spawning a new one.
        self.kill(&session_id).await;

        let argv = resolve_agent_command(&self.overrides, agent_kind);
        let spawn = tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn();

        let mut child = match spawn {
            Ok(child) => child,
            Err(error) => {
                tracing::error!(
                    session_id = %session_id,
                    command = ?argv,
                    "failed to spawn agent: {error}"
                );
                self.emit_event(&session_id, 1, AgentEvent::Error {
                    message: format!("failed to spawn {}: {error}", argv.join(" ")),
                })
                .await;
                let _ = self
                    .outbound
                    .send(MachineToHub::AgentSessionUpdate {
                        session_id: session_id.clone(),
                        status: Some(AgentSessionStatus::Error),
                        title: None,
                        acp_session_id: None,
                    })
                    .await;
                let _ = self
                    .outbound
                    .send(MachineToHub::AgentSessionExited {
                        session_id,
                        reason: "spawn failed".to_string(),
                    })
                    .await;
                return;
            }
        };

        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(64);
        let (actor_tx, actor_rx) = mpsc::channel::<ActorMsg>(256);
        let ended = Arc::new(AtomicBool::new(false));

        // Bridge hub commands into the actor's single event loop.
        {
            let actor_tx = actor_tx.clone();
            tokio::spawn(async move {
                let mut cmd_rx = cmd_rx;
                while let Some(cmd) = cmd_rx.recv().await {
                    if actor_tx.send(ActorMsg::Command(cmd)).await.is_err() {
                        break;
                    }
                }
            });
        }

        // Reader: child stdout → actor. ndjson, one JSON-RPC message per line.
        {
            let actor_tx = actor_tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if actor_tx.send(ActorMsg::Line(line)).await.is_err() {
                                return;
                            }
                        }
                        Ok(None) => {
                            let _ = actor_tx
                                .send(ActorMsg::Eof("agent process closed stdout".to_string()))
                                .await;
                            return;
                        }
                        Err(error) => {
                            let _ = actor_tx
                                .send(ActorMsg::Eof(format!("stdout read failed: {error}")))
                                .await;
                            return;
                        }
                    }
                }
            });
        }

        let actor = SessionActor {
            session_id: session_id.clone(),
            auto_run,
            seq: 0,
            acp_session_id: None,
            resume_acp_session_id,
            suppress_updates: false,
            failed: false,
            pending_question: None,
            pending: HashMap::new(),
            next_rpc_id: 1,
            stdin,
            child,
            outbound: self.outbound.clone(),
            self_tx: actor_tx,
            ended: ended.clone(),
        };
        tokio::spawn(actor.run(actor_rx));

        self.sessions.lock().unwrap().insert(
            session_id,
            AcpSessionHandle { cmd_tx, ended },
        );
    }

    pub async fn prompt(&self, session_id: &str, text: String) {
        self.send_command(session_id, SessionCommand::Prompt { text })
            .await;
    }

    pub async fn answer(
        &self,
        session_id: &str,
        request_id: String,
        option_id: Option<String>,
        text: Option<String>,
    ) {
        self.send_command(
            session_id,
            SessionCommand::Answer {
                request_id,
                option_id,
                text,
            },
        )
        .await;
    }

    pub async fn cancel(&self, session_id: &str) {
        self.send_command(session_id, SessionCommand::Cancel).await;
    }

    /// Terminate the agent process. The actor reports AgentSessionExited once
    /// the child's stdout closes.
    pub async fn kill(&self, session_id: &str) {
        let handle = self.sessions.lock().unwrap().remove(session_id);
        if let Some(handle) = handle {
            let _ = handle.cmd_tx.send(SessionCommand::Kill).await;
        }
    }

    /// Kill every session (hub connection dropped or machine shutting down).
    pub async fn kill_all(&self) {
        let handles: Vec<AcpSessionHandle> =
            self.sessions.lock().unwrap().drain().map(|(_, h)| h).collect();
        for handle in handles {
            let _ = handle.cmd_tx.send(SessionCommand::Kill).await;
        }
    }

    async fn send_command(&self, session_id: &str, cmd: SessionCommand) {
        let handle = self.sessions.lock().unwrap().get(session_id).map(|h| {
            (h.cmd_tx.clone(), h.ended.clone())
        });
        match handle {
            Some((cmd_tx, ended)) if !ended.load(Ordering::Acquire) => {
                if cmd_tx.send(cmd).await.is_err() {
                    tracing::warn!(session_id = %session_id, "agent session actor is gone");
                }
            }
            _ => {
                tracing::warn!(session_id = %session_id, "command for unknown agent session");
            }
        }
    }

    async fn emit_event(&self, session_id: &str, seq: u64, event: AgentEvent) {
        let _ = self
            .outbound
            .send(MachineToHub::AgentSessionEvent {
                session_id: session_id.to_string(),
                seq,
                event,
            })
            .await;
    }
}

/// What an in-flight JSON-RPC request is waiting for.
#[derive(Debug, PartialEq)]
enum PendingRpc {
    Initialize,
    SessionNew,
    SessionLoad,
    Prompt,
}

struct SessionActor {
    session_id: String,
    auto_run: bool,
    /// Per-session monotonic event sequence, machine-assigned, starts at 1.
    seq: u64,
    acp_session_id: Option<String>,
    resume_acp_session_id: Option<String>,
    /// True while session/load is replaying history: those updates must not
    /// be re-emitted to the hub, which already has them.
    suppress_updates: bool,
    /// Set once the session has failed; guards against duplicate Error events.
    failed: bool,
    /// Parked session/request_permission: (request_id string, JSON-RPC id).
    pending_question: Option<(String, Value)>,
    pending: HashMap<u64, PendingRpc>,
    next_rpc_id: u64,
    stdin: ChildStdin,
    child: Child,
    outbound: mpsc::Sender<MachineToHub>,
    self_tx: mpsc::Sender<ActorMsg>,
    ended: Arc<AtomicBool>,
}

impl SessionActor {
    async fn run(mut self, mut rx: mpsc::Receiver<ActorMsg>) {
        self.begin().await;
        while let Some(msg) = rx.recv().await {
            match msg {
                ActorMsg::Command(cmd) => self.handle_command(cmd).await,
                ActorMsg::Line(line) => self.handle_line(&line).await,
                ActorMsg::Eof(reason) => {
                    self.on_eof(reason).await;
                    break;
                }
                ActorMsg::HandshakeTimeout(id) => self.on_handshake_timeout(id).await,
            }
            if self.ended.load(Ordering::Acquire) {
                break;
            }
        }
        // Never leave the agent running past its session.
        let _ = self.child.kill().await;
    }

    /// Kick off the ACP handshake.
    async fn begin(&mut self) {
        self.send_request(
            PendingRpc::Initialize,
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {"fs": {"readTextFile": false, "writeTextFile": false}},
            }),
        )
        .await;
    }

    async fn write_message(&mut self, value: &Value) {
        let mut line = serde_json::to_vec(value).expect("JSON-RPC messages serialize");
        line.push(b'\n');
        if let Err(error) = self.stdin.write_all(&line).await {
            tracing::warn!(session_id = %self.session_id, "agent stdin write failed: {error}");
        } else {
            let _ = self.stdin.flush().await;
        }
    }

    async fn send_request(&mut self, kind: PendingRpc, method: &str, params: Value) {
        let id = self.next_rpc_id;
        self.next_rpc_id += 1;
        // Handshake steps fail the session if the agent never answers.
        let needs_watchdog =
            matches!(kind, PendingRpc::Initialize | PendingRpc::SessionNew | PendingRpc::SessionLoad);
        self.pending.insert(id, kind);
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .await;

        if needs_watchdog {
            let self_tx = self.self_tx.clone();
            tokio::spawn(async move {
                tokio::time::sleep(HANDSHAKE_TIMEOUT).await;
                let _ = self_tx.send(ActorMsg::HandshakeTimeout(id)).await;
            });
        }
    }

    async fn send_notification(&mut self, method: &str, params: Value) {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await;
    }

    async fn handle_command(&mut self, cmd: SessionCommand) {
        match cmd {
            SessionCommand::Prompt { text } => self.handle_prompt(text).await,
            SessionCommand::Answer {
                request_id,
                option_id,
                text,
            } => self.handle_answer(request_id, option_id, text).await,
            SessionCommand::Cancel => {
                if let Some(acp_session_id) = self.acp_session_id.clone() {
                    self.send_notification("session/cancel", json!({"sessionId": acp_session_id}))
                        .await;
                }
            }
            SessionCommand::Kill => {
                // Unblock a parked permission request so the agent's own
                // teardown path can run before we kill it.
                if let Some((_, rpc_id)) = self.pending_question.take() {
                    self.write_message(&json!({
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "result": {"outcome": {"outcome": "cancelled"}},
                    }))
                    .await;
                }
                let _ = self.child.kill().await;
            }
        }
    }

    async fn handle_prompt(&mut self, text: String) {
        let Some(acp_session_id) = self.acp_session_id.clone() else {
            self.emit_event(AgentEvent::Error {
                message: "agent session is not ready yet".to_string(),
            })
            .await;
            return;
        };
        // Echo of the prompt: the event log is the full transcript.
        self.emit_event(AgentEvent::UserMessage { text: text.clone() })
            .await;
        self.send_status(AgentSessionStatus::Working).await;
        self.send_request(
            PendingRpc::Prompt,
            "session/prompt",
            json!({
                "sessionId": acp_session_id,
                "prompt": [{"type": "text", "text": text}],
            }),
        )
        .await;
    }

    async fn handle_answer(
        &mut self,
        request_id: String,
        option_id: Option<String>,
        text: Option<String>,
    ) {
        let Some((pending_request_id, rpc_id)) = self.pending_question.take() else {
            tracing::warn!(
                session_id = %self.session_id,
                request_id = %request_id,
                "answer for a question that is not pending"
            );
            return;
        };
        if pending_request_id != request_id {
            // Not our question: re-park and ignore.
            self.pending_question = Some((pending_request_id, rpc_id));
            return;
        }
        let outcome = match option_id {
            Some(option_id) => json!({"outcome": "selected", "optionId": option_id}),
            // ACP request_permission has no free-form answer channel; a
            // text-only answer cancels the request.
            None => {
                if text.is_some() {
                    tracing::info!(
                        session_id = %self.session_id,
                        "text-only answer has no ACP channel; cancelling the permission request"
                    );
                }
                json!({"outcome": "cancelled"})
            }
        };
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {"outcome": outcome},
        }))
        .await;
        self.emit_event(AgentEvent::QuestionResolved { request_id })
            .await;
        self.send_status(AgentSessionStatus::Working).await;
    }

    async fn handle_line(&mut self, line: &str) {
        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            // Malformed output from the child must not kill the session.
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    "ignoring malformed agent output line: {error}"
                );
                return;
            }
        };

        if let Some(method) = message.get("method").and_then(Value::as_str) {
            match method {
                "session/update" => self.handle_session_update(&message).await,
                "session/request_permission" => self.handle_permission_request(&message).await,
                _ => {
                    // Unknown server request: answer method-not-found so the
                    // agent never hangs waiting on us. Notifications carry no
                    // id and are simply ignored (forward-compat).
                    if let Some(id) = message.get("id") {
                        let id = id.clone();
                        self.write_message(&json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {"code": -32601, "message": format!("method not found: {method}")},
                        }))
                        .await;
                    }
                }
            }
            return;
        }

        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            self.handle_response(id, &message).await;
        }
    }

    async fn handle_session_update(&mut self, message: &Value) {
        let update = message
            .get("params")
            .and_then(|params| params.get("update"))
            .cloned()
            .unwrap_or(Value::Null);
        if self.suppress_updates {
            // session/load history replay: track state only, the hub already
            // has these events.
            return;
        }
        if let Some(event) = map_session_update(&update) {
            self.emit_event(event).await;
        }
    }

    async fn handle_permission_request(&mut self, message: &Value) {
        let Some(rpc_id) = message.get("id").cloned() else {
            return;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let options: Vec<&Value> = params
            .get("options")
            .and_then(Value::as_array)
            .map(|options| options.iter().collect())
            .unwrap_or_default();

        if self.auto_run {
            // Auto-run (yolo): pick the first allow option, preferring
            // allow_once. No event is emitted for auto-approved requests.
            let selected = options
                .iter()
                .find(|option| option.get("kind").and_then(Value::as_str) == Some("allow_once"))
                .or_else(|| {
                    options.iter().find(|option| {
                        option
                            .get("kind")
                            .and_then(Value::as_str)
                            .map(|kind| kind.starts_with("allow"))
                            .unwrap_or(false)
                    })
                })
                .and_then(|option| option.get("optionId").and_then(Value::as_str))
                .map(str::to_string);
            let outcome = match selected {
                Some(option_id) => json!({"outcome": "selected", "optionId": option_id}),
                None => json!({"outcome": "cancelled"}),
            };
            self.write_message(&json!({
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {"outcome": outcome},
            }))
            .await;
            return;
        }

        let request_id = rpc_id_string(&rpc_id);
        let prompt = params
            .get("toolCall")
            .and_then(|tool_call| tool_call.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Permission requested")
            .to_string();
        let options: Vec<AgentQuestionOption> = options
            .iter()
            .map(|option| AgentQuestionOption {
                id: option
                    .get("optionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                label: option
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                detail: None,
            })
            .collect();
        self.pending_question = Some((request_id.clone(), rpc_id));
        self.emit_event(AgentEvent::Question {
            request_id,
            prompt,
            options,
        })
        .await;
        self.send_status(AgentSessionStatus::Asked).await;
    }

    async fn handle_response(&mut self, id: u64, message: &Value) {
        let Some(kind) = self.pending.remove(&id) else {
            return;
        };
        if let Some(error) = message.get("error") {
            let text = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown JSON-RPC error")
                .to_string();
            self.handle_rpc_error(kind, text).await;
            return;
        }
        let result = message.get("result").cloned().unwrap_or(Value::Null);
        match kind {
            PendingRpc::Initialize => self.start_acp_session().await,
            PendingRpc::SessionNew => {
                self.suppress_updates = false;
                self.acp_session_id = result
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let _ = self
                    .outbound
                    .send(MachineToHub::AgentSessionUpdate {
                        session_id: self.session_id.clone(),
                        status: Some(AgentSessionStatus::Idle),
                        title: None,
                        acp_session_id: self.acp_session_id.clone(),
                    })
                    .await;
            }
            PendingRpc::SessionLoad => {
                self.suppress_updates = false;
                self.send_status(AgentSessionStatus::Idle).await;
            }
            PendingRpc::Prompt => {
                let stop_reason = result
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn")
                    .to_string();
                self.emit_event(AgentEvent::TurnEnded { stop_reason }).await;
                let status = if self.pending_question.is_some() {
                    AgentSessionStatus::Asked
                } else {
                    AgentSessionStatus::Idle
                };
                self.send_status(status).await;
            }
        }
    }

    async fn handle_rpc_error(&mut self, kind: PendingRpc, text: String) {
        match kind {
            PendingRpc::SessionLoad => {
                // The agent no longer has that history: start fresh and say so.
                self.suppress_updates = false;
                self.emit_event(AgentEvent::Error {
                    message: format!("session history was not restored: {text}"),
                })
                .await;
                self.start_acp_session_fresh().await;
            }
            PendingRpc::Initialize | PendingRpc::SessionNew => {
                self.fail(format!("ACP handshake failed: {text}")).await;
            }
            PendingRpc::Prompt => {
                self.emit_event(AgentEvent::Error { message: text }).await;
                self.send_status(AgentSessionStatus::Idle).await;
            }
        }
    }

    /// Handshake succeeded: resume via session/load when asked to, else
    /// session/new.
    async fn start_acp_session(&mut self) {
        if let Some(acp_session_id) = self.resume_acp_session_id.clone() {
            self.suppress_updates = true;
            self.send_request(
                PendingRpc::SessionLoad,
                "session/load",
                json!({
                    "sessionId": acp_session_id,
                    "cwd": ".",
                    "mcpServers": [],
                }),
            )
            .await;
        } else {
            self.start_acp_session_fresh().await;
        }
    }

    async fn start_acp_session_fresh(&mut self) {
        self.send_request(
            PendingRpc::SessionNew,
            "session/new",
            json!({"cwd": ".", "mcpServers": []}),
        )
        .await;
    }

    async fn on_handshake_timeout(&mut self, id: u64) {
        if let Some(kind) = self.pending.remove(&id) {
            self.fail(format!("ACP {kind:?} timed out after {HANDSHAKE_TIMEOUT:?}"))
                .await;
        }
    }

    /// Fail the session: Error event, Error status, kill the child. The
    /// resulting EOF reports AgentSessionExited.
    async fn fail(&mut self, message: String) {
        if self.failed {
            return;
        }
        self.failed = true;
        tracing::error!(session_id = %self.session_id, "{message}");
        self.emit_event(AgentEvent::Error { message }).await;
        self.send_status(AgentSessionStatus::Error).await;
        let _ = self.child.kill().await;
    }

    async fn on_eof(&mut self, reason: String) {
        if self.ended.swap(true, Ordering::AcqRel) {
            return;
        }
        let status = self
            .child
            .try_wait()
            .ok()
            .flatten()
            .map(|status| format!(" ({status})"))
            .unwrap_or_default();
        let _ = self
            .outbound
            .send(MachineToHub::AgentSessionExited {
                session_id: self.session_id.clone(),
                reason: format!("{reason}{status}"),
            })
            .await;
    }

    async fn emit_event(&mut self, event: AgentEvent) {
        self.seq += 1;
        let _ = self
            .outbound
            .send(MachineToHub::AgentSessionEvent {
                session_id: self.session_id.clone(),
                seq: self.seq,
                event,
            })
            .await;
    }

    async fn send_status(&self, status: AgentSessionStatus) {
        let _ = self
            .outbound
            .send(MachineToHub::AgentSessionUpdate {
                session_id: self.session_id.clone(),
                status: Some(status),
                title: None,
                acp_session_id: None,
            })
            .await;
    }
}

/// JSON-RPC ids can be strings or numbers; the Question request_id is the
/// wire form so the browser can hand it back verbatim in AgentSessionAnswer.
fn rpc_id_string(id: &Value) -> String {
    match id {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn capped(value: &Value, cap: usize) -> String {
    let mut text = serde_json::to_string(value).unwrap_or_default();
    if text.len() > cap {
        let mut end = cap;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

fn content_text(update: &Value) -> String {
    update
        .get("content")
        .and_then(|content| content.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Map one ACP session/update payload to a normalized AgentEvent. Unknown
/// update kinds return None and are ignored (forward-compat).
fn map_session_update(update: &Value) -> Option<AgentEvent> {
    let kind = update.get("sessionUpdate")?.as_str()?;
    match kind {
        "agent_message_chunk" => Some(AgentEvent::AgentMessageChunk {
            text: content_text(update),
        }),
        "agent_thought_chunk" => Some(AgentEvent::ThoughtChunk {
            text: content_text(update),
        }),
        "tool_call" => Some(AgentEvent::ToolCall {
            tool_call_id: update
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            title: update
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            kind: update
                .get("kind")
                .and_then(Value::as_str)
                .map(str::to_string),
            status: update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending")
                .to_string(),
        }),
        "tool_call_update" => Some(AgentEvent::ToolCallUpdate {
            tool_call_id: update
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: update
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string),
            content: update.get("content").map(|c| capped(c, TOOL_CALL_CONTENT_CAP)),
        }),
        "plan" => Some(AgentEvent::Plan {
            entries_json: update
                .get("entries")
                .map(|entries| capped(entries, TOOL_CALL_CONTENT_CAP))
                .unwrap_or_else(|| "[]".to_string()),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// argv for the fake ACP agent, or None when python3/the script is
    /// unavailable (tests then skip).
    fn fake_agent_command(ask: bool) -> Option<Vec<String>> {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../e2e/fake-acp-agent.py")
            .canonicalize()
            .ok()?;
        let python3_available = std::process::Command::new("python3")
            .arg("-V")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !python3_available {
            return None;
        }
        let mut argv: Vec<String> = if ask {
            // FAKE_ACP_ASK=1 without spawning through a shell.
            vec!["env".to_string(), "FAKE_ACP_ASK=1".to_string()]
        } else {
            Vec::new()
        };
        argv.push("python3".to_string());
        argv.push(script.to_string_lossy().into_owned());
        Some(argv)
    }

    fn harness(ask: bool) -> Option<(AcpManager, mpsc::Receiver<MachineToHub>)> {
        let argv = fake_agent_command(ask)?;
        let (tx, rx) = mpsc::channel(256);
        let overrides = HashMap::from([("kimi".to_string(), argv)]);
        Some((AcpManager::new(overrides, tx), rx))
    }

    /// Collect hub-bound messages until `done` matches, or fail after 15s.
    async fn collect_until(
        rx: &mut mpsc::Receiver<MachineToHub>,
        mut done: impl FnMut(&MachineToHub) -> bool,
    ) -> Vec<MachineToHub> {
        let mut out = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(msg)) => {
                    let finished = done(&msg);
                    out.push(msg);
                    if finished {
                        return out;
                    }
                }
                _ => panic!("timed out waiting for expected message; got so far: {out:?}"),
            }
        }
    }

    fn is_turn_ended(msg: &MachineToHub) -> bool {
        matches!(
            msg,
            MachineToHub::AgentSessionEvent {
                event: AgentEvent::TurnEnded { .. },
                ..
            }
        )
    }

    fn session_ready(msg: &MachineToHub) -> bool {
        matches!(
            msg,
            MachineToHub::AgentSessionUpdate {
                acp_session_id: Some(_),
                ..
            }
        )
    }

    fn events_of(msgs: &[MachineToHub]) -> Vec<(u64, &AgentEvent)> {
        msgs.iter()
            .filter_map(|msg| match msg {
                MachineToHub::AgentSessionEvent { seq, event, .. } => Some((*seq, event)),
                _ => None,
            })
            .collect()
    }

    fn statuses_of(msgs: &[MachineToHub]) -> Vec<AgentSessionStatus> {
        msgs.iter()
            .filter_map(|msg| match msg {
                MachineToHub::AgentSessionUpdate {
                    status: Some(status),
                    ..
                } => Some(*status),
                _ => None,
            })
            .collect()
    }

    async fn start_and_wait_ready(
        manager: &AcpManager,
        rx: &mut mpsc::Receiver<MachineToHub>,
        session_id: &str,
        auto_run: bool,
        resume_acp_session_id: Option<String>,
    ) -> Vec<MachineToHub> {
        manager
            .start_session(
                session_id.to_string(),
                AgentKind::Kimi,
                "/tmp".to_string(),
                auto_run,
                resume_acp_session_id,
            )
            .await;
        collect_until(rx, session_ready).await
    }

    #[tokio::test]
    async fn prompt_produces_normalized_event_sequence() {
        let Some((manager, mut rx)) = harness(false) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        let ready = start_and_wait_ready(&manager, &mut rx, "s-basic", false, None).await;
        assert!(ready.iter().any(|msg| matches!(
            msg,
            MachineToHub::AgentSessionUpdate {
                status: Some(AgentSessionStatus::Idle),
                acp_session_id: Some(id),
                ..
            } if id == "fake-session-1"
        )));

        manager.prompt("s-basic", "hello world".to_string()).await;
        // TurnEnded is followed by the trailing Idle status update; collect
        // through it so the statuses are complete.
        let mut saw_turn_end = false;
        let msgs = collect_until(&mut rx, |msg| {
            saw_turn_end |= is_turn_ended(msg);
            saw_turn_end
                && matches!(
                    msg,
                    MachineToHub::AgentSessionUpdate {
                        status: Some(AgentSessionStatus::Idle),
                        ..
                    }
                )
        })
        .await;

        let events = events_of(&msgs);
        let seqs: Vec<u64> = events.iter().map(|(seq, _)| *seq).collect();
        assert_eq!(seqs, vec![1, 2, 3, 4, 5, 6], "per-session seq starts at 1");
        assert!(
            matches!(&events[0].1, AgentEvent::UserMessage { text } if text == "hello world"),
            "the prompt echo leads the transcript"
        );
        assert!(
            matches!(&events[1].1, AgentEvent::ThoughtChunk { text } if text == "thinking about: hello world")
        );
        assert!(
            matches!(&events[2].1, AgentEvent::AgentMessageChunk { text } if text == "echo: hello world")
        );
        assert!(matches!(
            &events[3].1,
            AgentEvent::ToolCall {
                tool_call_id,
                title,
                kind: Some(kind),
                status,
            } if tool_call_id == "fake-call-1" && title == "fake tool" && kind == "other" && status == "in_progress"
        ));
        assert!(matches!(
            &events[4].1,
            AgentEvent::ToolCallUpdate {
                tool_call_id,
                status: Some(status),
                content: Some(_),
            } if tool_call_id == "fake-call-1" && status == "completed"
        ));
        assert!(
            matches!(&events[5].1, AgentEvent::TurnEnded { stop_reason } if stop_reason == "end_turn")
        );

        let statuses = statuses_of(&msgs);
        assert_eq!(
            statuses,
            vec![AgentSessionStatus::Working, AgentSessionStatus::Idle]
        );
        manager.kill_all().await;
    }

    #[tokio::test]
    async fn auto_run_approves_permission_without_a_question_event() {
        let Some((manager, mut rx)) = harness(true) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        start_and_wait_ready(&manager, &mut rx, "s-auto", true, None).await;

        manager.prompt("s-auto", "do it".to_string()).await;
        let msgs = collect_until(&mut rx, is_turn_ended).await;

        assert!(
            !events_of(&msgs)
                .iter()
                .any(|(_, event)| matches!(event, AgentEvent::Question { .. })),
            "auto_run must auto-approve without surfacing a Question"
        );
        assert!(events_of(&msgs).iter().any(
            |(_, event)| matches!(event, AgentEvent::TurnEnded { stop_reason } if stop_reason == "end_turn")
        ));
        manager.kill_all().await;
    }

    #[tokio::test]
    async fn question_parks_until_answer_resolves_it() {
        let Some((manager, mut rx)) = harness(true) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        start_and_wait_ready(&manager, &mut rx, "s-ask", false, None).await;

        manager.prompt("s-ask", "may I?".to_string()).await;
        // The Asked status update trails the Question event; collect through
        // it so both are captured.
        let mut saw_question = false;
        let msgs = collect_until(&mut rx, |msg| {
            saw_question |= matches!(
                msg,
                MachineToHub::AgentSessionEvent {
                    event: AgentEvent::Question { .. },
                    ..
                }
            );
            saw_question
                && matches!(
                    msg,
                    MachineToHub::AgentSessionUpdate {
                        status: Some(AgentSessionStatus::Asked),
                        ..
                    }
                )
        })
        .await;

        let request_id = events_of(&msgs)
            .into_iter()
            .find_map(|(_, event)| match event {
                AgentEvent::Question {
                    request_id,
                    prompt,
                    options,
                } => {
                    assert_eq!(prompt, "fake tool");
                    assert_eq!(options.len(), 3);
                    assert_eq!(options[0].id, "allow-once");
                    assert_eq!(options[0].label, "Allow once");
                    Some(request_id.clone())
                }
                _ => None,
            })
            .expect("a Question event");
        assert_eq!(request_id, "fake-permission-1");
        assert!(
            statuses_of(&msgs).contains(&AgentSessionStatus::Asked),
            "the session parks in Asked while waiting"
        );

        manager
            .answer("s-ask", request_id.clone(), Some("allow-once".to_string()), None)
            .await;
        let mut saw_turn_end = false;
        let msgs = collect_until(&mut rx, |msg| {
            saw_turn_end |= is_turn_ended(msg);
            saw_turn_end
                && matches!(
                    msg,
                    MachineToHub::AgentSessionUpdate {
                        status: Some(AgentSessionStatus::Idle),
                        ..
                    }
                )
        })
        .await;
        let events = events_of(&msgs);
        assert!(events.iter().any(
            |(_, event)| matches!(event, AgentEvent::QuestionResolved { request_id: id } if *id == request_id)
        ));
        assert!(events.iter().any(
            |(_, event)| matches!(event, AgentEvent::TurnEnded { stop_reason } if stop_reason == "end_turn")
        ));
        let statuses = statuses_of(&msgs);
        assert_eq!(
            statuses,
            vec![AgentSessionStatus::Working, AgentSessionStatus::Idle]
        );
        manager.kill_all().await;
    }

    #[tokio::test]
    async fn child_crash_reports_exited() {
        let Some((manager, mut rx)) = harness(false) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        start_and_wait_ready(&manager, &mut rx, "s-die", false, None).await;

        // The fake agent hard-exits on this prompt without responding.
        manager.prompt("s-die", "die".to_string()).await;
        let msgs = collect_until(&mut rx, |msg| {
            matches!(msg, MachineToHub::AgentSessionExited { .. })
        })
        .await;

        assert!(msgs.iter().any(|msg| matches!(
            msg,
            MachineToHub::AgentSessionExited { session_id, .. } if session_id == "s-die"
        )));
        assert!(
            !events_of(&msgs).iter().any(|(_, event)| matches!(event, AgentEvent::TurnEnded { .. })),
            "a crashed agent never ends its turn"
        );
        manager.kill_all().await;
    }

    #[tokio::test]
    async fn kill_terminates_the_agent_process() {
        let Some((manager, mut rx)) = harness(false) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        start_and_wait_ready(&manager, &mut rx, "s-kill", false, None).await;

        manager.prompt("s-kill", "hi".to_string()).await;
        collect_until(&mut rx, is_turn_ended).await;

        manager.kill("s-kill").await;
        let msgs = collect_until(&mut rx, |msg| {
            matches!(msg, MachineToHub::AgentSessionExited { .. })
        })
        .await;
        assert!(msgs.iter().any(|msg| matches!(
            msg,
            MachineToHub::AgentSessionExited { session_id, .. } if session_id == "s-kill"
        )));
        manager.kill_all().await;
    }

    #[tokio::test]
    async fn resume_falls_back_to_a_new_session_when_history_is_gone() {
        let Some((manager, mut rx)) = harness(false) else {
            eprintln!("skipping: python3 or e2e/fake-acp-agent.py unavailable");
            return;
        };
        // A fresh fake agent has no "old-session" to load: session/load
        // errors and the client must fall back to session/new.
        let msgs = start_and_wait_ready(
            &manager,
            &mut rx,
            "s-resume",
            false,
            Some("old-session".to_string()),
        )
        .await;

        assert!(events_of(&msgs).iter().any(|(_, event)| matches!(
            event,
            AgentEvent::Error { message } if message.contains("history was not restored")
        )));
        assert!(msgs.iter().any(|msg| matches!(
            msg,
            MachineToHub::AgentSessionUpdate {
                status: Some(AgentSessionStatus::Idle),
                acp_session_id: Some(id),
                ..
            } if id == "fake-session-1"
        )));

        // The fallback session is fully usable.
        manager.prompt("s-resume", "still here".to_string()).await;
        let msgs = collect_until(&mut rx, is_turn_ended).await;
        assert!(events_of(&msgs).iter().any(
            |(_, event)| matches!(event, AgentEvent::AgentMessageChunk { text } if text == "echo: still here")
        ));
        manager.kill_all().await;
    }
}
