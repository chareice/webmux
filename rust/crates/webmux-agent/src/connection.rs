use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, sleep};
use tracing::{error, info, warn};
use uuid::Uuid;

use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use webmux_shared::{
    AgentMessage, AgentTaskMessagePayload, CommandStatus, InstructionsResultPayload,
    InstructionsWrittenPayload, MessageRole, RepositoryBrowseResultPayload,
    RunImageAttachmentUpload, RunStatus, RunTimelineEventPayload, RunTimelineEventStatus, RunTool,
    RunTurnOptions, ServerToAgentMessage, StepStatus, StepType, TaskStepWithoutTaskId,
};

use crate::repositories::browse_repositories;
use crate::run_wrapper::{
    start_run, ActiveHandle, RunCallbacks, RunWrapperOptions,
};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------
// AgentConnection
// ---------------------------------------------------------------------------

pub struct AgentConnection {
    server_url: String,
    agent_id: String,
    agent_secret: String,
    workspace_root: String,
}

impl AgentConnection {
    pub fn new(
        server_url: String,
        agent_id: String,
        agent_secret: String,
        workspace_root: String,
    ) -> Self {
        Self {
            server_url,
            agent_id,
            agent_secret,
            workspace_root,
        }
    }

    /// Run the agent connection loop. This method does not return under normal
    /// conditions — it reconnects with exponential backoff on disconnection.
    ///
    /// Provide a `shutdown_rx` that resolves when the agent should stop.
    pub async fn run(&self, mut shutdown_rx: tokio::sync::watch::Receiver<bool>) {
        let mut reconnect_delay = INITIAL_RECONNECT_DELAY;

        loop {
            let ws_url = build_ws_url(&self.server_url);
            info!("Connecting to {ws_url}");

            match connect_async(&ws_url).await {
                Ok((ws_stream, _)) => {
                    info!("WebSocket connected, authenticating...");
                    reconnect_delay = INITIAL_RECONNECT_DELAY;

                    let result = self
                        .run_session(ws_stream, &mut shutdown_rx)
                        .await;

                    if result.is_shutdown() {
                        info!("Shutting down");
                        return;
                    }

                    info!("WebSocket disconnected");
                }
                Err(e) => {
                    error!("Failed to connect: {e}");
                }
            }

            // Check for shutdown before reconnecting
            if *shutdown_rx.borrow() {
                info!("Shutting down");
                return;
            }

            info!("Reconnecting in {}ms...", reconnect_delay.as_millis());

            tokio::select! {
                _ = sleep(reconnect_delay) => {}
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        info!("Shutting down");
                        return;
                    }
                }
            }

            // Exponential backoff
            reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
        }
    }

    /// Run a single WebSocket session (auth + heartbeat + message loop).
    async fn run_session<S>(
        &self,
        ws_stream: S,
        shutdown_rx: &mut tokio::sync::watch::Receiver<bool>,
    ) -> SessionResult
    where
        S: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
            + futures_util::Sink<WsMessage, Error = tokio_tungstenite::tungstenite::Error>
            + Unpin
            + Send
            + 'static,
    {
        let (ws_write, mut ws_read) = ws_stream.split();
        let ws_write = Arc::new(Mutex::new(ws_write));

        // Send auth message
        let auth_msg = AgentMessage::Auth {
            agent_id: self.agent_id.clone(),
            agent_secret: self.agent_secret.clone(),
            version: Some(AGENT_VERSION.to_string()),
        };
        if let Err(e) = send_agent_message(&ws_write, &auth_msg).await {
            error!("Failed to send auth: {e}");
            return SessionResult::Disconnected;
        }

        // Channel for internal commands (messages to send from async tasks)
        let (internal_tx, mut internal_rx) = mpsc::channel::<AgentMessage>(256);
        let workspace_root = self.workspace_root.clone();

        // Active runs tracking
        let runs: Arc<Mutex<HashMap<String, RunEntry>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // Task session state
        let task_sessions: Arc<Mutex<HashMap<String, TaskSession>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // Task runs (taskId -> RunEntry key)
        let task_runs: Arc<Mutex<HashMap<String, TaskRunInfo>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let mut heartbeat_started = false;
        let mut heartbeat_interval = interval(HEARTBEAT_INTERVAL);
        // Don't fire the first tick immediately
        heartbeat_interval.tick().await;

        loop {
            tokio::select! {
                // WS message received
                ws_msg = ws_read.next() => {
                    match ws_msg {
                        Some(Ok(WsMessage::Text(text))) => {
                            let msg: ServerToAgentMessage = match serde_json::from_str(&text) {
                                Ok(m) => m,
                                Err(e) => {
                                    error!("Failed to parse server message: {e}");
                                    continue;
                                }
                            };

                            match msg {
                                ServerToAgentMessage::AuthOk { upgrade_policy } => {
                                    info!("Authenticated successfully");
                                    heartbeat_started = true;
                                    // Upgrade policy is logged but not acted upon in the
                                    // Rust agent (no managed-release mechanism).
                                    if let Some(policy) = &upgrade_policy {
                                        if let Some(target) = &policy.target_version {
                                            info!("Server recommends upgrade to {target}");
                                        }
                                    }
                                }
                                ServerToAgentMessage::AuthFail { message } => {
                                    error!("Authentication failed: {message}");
                                    return SessionResult::AuthFailed;
                                }
                                ServerToAgentMessage::RepositoryBrowse { request_id, path } => {
                                    let tx = internal_tx.clone();
                                    let root = workspace_root.clone();
                                    tokio::spawn(async move {
                                        handle_repository_browse(tx, &root, &request_id, path.as_deref()).await;
                                    });
                                }
                                ServerToAgentMessage::ReadInstructions { request_id, tool } => {
                                    let tx = internal_tx.clone();
                                    tokio::spawn(async move {
                                        handle_read_instructions(tx, &request_id, tool).await;
                                    });
                                }
                                ServerToAgentMessage::WriteInstructions { request_id, tool, content } => {
                                    let tx = internal_tx.clone();
                                    tokio::spawn(async move {
                                        handle_write_instructions(tx, &request_id, tool, &content).await;
                                    });
                                }
                                ServerToAgentMessage::RunTurnStart {
                                    run_id,
                                    turn_id,
                                    tool,
                                    repo_path,
                                    prompt,
                                    tool_thread_id,
                                    attachments,
                                    options,
                                } => {
                                    handle_run_start(
                                        &runs,
                                        internal_tx.clone(),
                                        run_id,
                                        turn_id,
                                        tool,
                                        repo_path,
                                        prompt,
                                        tool_thread_id,
                                        attachments.unwrap_or_default(),
                                        options.unwrap_or(RunTurnOptions {
                                            model: None,
                                            claude_effort: None,
                                            codex_effort: None,
                                            clear_session: None,
                                        }),
                                    ).await;
                                }
                                ServerToAgentMessage::RunTurnInterrupt { run_id, turn_id } => {
                                    handle_run_interrupt(&runs, &run_id, &turn_id).await;
                                }
                                ServerToAgentMessage::RunTurnKill { run_id, turn_id } => {
                                    handle_run_kill(&runs, &run_id, &turn_id).await;
                                }
                                ServerToAgentMessage::TaskDispatch {
                                    task_id,
                                    project_id: _,
                                    repo_path,
                                    tool,
                                    title,
                                    prompt,
                                    llm_config: _,
                                    attachments,
                                } => {
                                    handle_task_dispatch(
                                        &runs,
                                        &task_sessions,
                                        &task_runs,
                                        internal_tx.clone(),
                                        &task_id,
                                        &repo_path,
                                        tool,
                                        &title,
                                        &prompt,
                                        attachments.unwrap_or_default(),
                                    ).await;
                                }
                                ServerToAgentMessage::TaskUserReply {
                                    task_id,
                                    content,
                                    attachments,
                                } => {
                                    handle_task_user_reply(
                                        &runs,
                                        &task_sessions,
                                        &task_runs,
                                        internal_tx.clone(),
                                        &task_id,
                                        &content,
                                        attachments.unwrap_or_default(),
                                    ).await;
                                }
                            }
                        }
                        Some(Ok(WsMessage::Close(_))) => {
                            info!("Server closed connection");
                            break;
                        }
                        Some(Err(e)) => {
                            error!("WebSocket error: {e}");
                            break;
                        }
                        None => {
                            info!("WebSocket stream ended");
                            break;
                        }
                        _ => {}
                    }
                }

                // Internal message to send
                Some(msg) = internal_rx.recv() => {
                    if let Err(e) = send_agent_message(&ws_write, &msg).await {
                        error!("Failed to send message: {e}");
                        break;
                    }
                }

                // Heartbeat
                _ = heartbeat_interval.tick(), if heartbeat_started => {
                    let msg = AgentMessage::Heartbeat {};
                    if let Err(e) = send_agent_message(&ws_write, &msg).await {
                        error!("Failed to send heartbeat: {e}");
                        break;
                    }
                }

                // Shutdown signal
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        // Dispose all runs
                        dispose_all_runs(&runs).await;
                        return SessionResult::Shutdown;
                    }
                }
            }
        }

        // Dispose all runs on disconnect
        dispose_all_runs(&runs).await;
        SessionResult::Disconnected
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum SessionResult {
    Disconnected,
    AuthFailed,
    Shutdown,
}

impl SessionResult {
    fn is_shutdown(&self) -> bool {
        matches!(self, SessionResult::Shutdown | SessionResult::AuthFailed)
    }
}

struct RunEntry {
    turn_id: String,
    handle: ActiveHandle,
}

struct TaskSession {
    tool_thread_id: Option<String>,
    repo_path: String,
    tool: RunTool,
}

#[allow(dead_code)]
struct TaskRunInfo {
    run_id: String,
    turn_id: String,
}

// ---------------------------------------------------------------------------
// Message sending
// ---------------------------------------------------------------------------

async fn send_agent_message<S>(
    ws: &Arc<Mutex<S>>,
    msg: &AgentMessage,
) -> Result<(), String>
where
    S: futures_util::Sink<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let mut sink = ws.lock().await;
    sink.send(WsMessage::Text(json.into()))
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Repository browsing
// ---------------------------------------------------------------------------

async fn handle_repository_browse(
    tx: mpsc::Sender<AgentMessage>,
    root_path: &str,
    request_id: &str,
    requested_path: Option<&str>,
) {
    match browse_repositories(root_path, requested_path).await {
        Ok(result) => {
            let _ = tx
                .send(AgentMessage::RepositoryBrowseResult(
                    RepositoryBrowseResultPayload::Ok {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(true),
                        current_path: result.current_path,
                        parent_path: result.parent_path,
                        entries: result.entries,
                    },
                ))
                .await;
        }
        Err(e) => {
            error!("Failed to browse repositories: {e}");
            let _ = tx
                .send(AgentMessage::RepositoryBrowseResult(
                    RepositoryBrowseResultPayload::Err {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(false),
                        error: e,
                    },
                ))
                .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Instructions read/write
// ---------------------------------------------------------------------------

fn tool_instructions_path(tool: &RunTool) -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    match tool {
        RunTool::Claude => home.join(".claude").join("CLAUDE.md"),
        RunTool::Codex => home.join(".codex").join("AGENTS.md"),
    }
}

async fn handle_read_instructions(
    tx: mpsc::Sender<AgentMessage>,
    request_id: &str,
    tool: RunTool,
) {
    let path = tool_instructions_path(&tool);
    let result = tokio::fs::read_to_string(&path).await;
    match result {
        Ok(content) => {
            let _ = tx
                .send(AgentMessage::InstructionsResult(
                    InstructionsResultPayload::Ok {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(true),
                        tool,
                        content: Some(content),
                    },
                ))
                .await;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let _ = tx
                .send(AgentMessage::InstructionsResult(
                    InstructionsResultPayload::Ok {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(true),
                        tool,
                        content: None,
                    },
                ))
                .await;
        }
        Err(e) => {
            error!("Failed to read instructions: {e}");
            let _ = tx
                .send(AgentMessage::InstructionsResult(
                    InstructionsResultPayload::Err {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(false),
                        tool,
                        error: e.to_string(),
                    },
                ))
                .await;
        }
    }
}

async fn handle_write_instructions(
    tx: mpsc::Sender<AgentMessage>,
    request_id: &str,
    tool: RunTool,
    content: &str,
) {
    let path = tool_instructions_path(&tool);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            error!("Failed to create instructions directory: {e}");
            let _ = tx
                .send(AgentMessage::InstructionsWritten(
                    InstructionsWrittenPayload::Err {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(false),
                        tool,
                        error: e.to_string(),
                    },
                ))
                .await;
            return;
        }
    }

    match tokio::fs::write(&path, content).await {
        Ok(()) => {
            let _ = tx
                .send(AgentMessage::InstructionsWritten(
                    InstructionsWrittenPayload::Ok {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(true),
                        tool,
                    },
                ))
                .await;
        }
        Err(e) => {
            error!("Failed to write instructions: {e}");
            let _ = tx
                .send(AgentMessage::InstructionsWritten(
                    InstructionsWrittenPayload::Err {
                        request_id: request_id.to_string(),
                        ok: serde_json::Value::Bool(false),
                        tool,
                        error: e.to_string(),
                    },
                ))
                .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Run management
// ---------------------------------------------------------------------------

async fn handle_run_start(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    tx: mpsc::Sender<AgentMessage>,
    run_id: String,
    turn_id: String,
    tool: RunTool,
    repo_path: String,
    prompt: String,
    tool_thread_id: Option<String>,
    attachments: Vec<RunImageAttachmentUpload>,
    options: RunTurnOptions,
) {
    // Dispose existing run with same id
    {
        let mut map = runs.lock().await;
        if let Some(mut entry) = map.remove(&run_id) {
            entry.handle.dispose();
        }
    }

    let opts = RunWrapperOptions {
        run_id: run_id.clone(),
        tool,
        tool_thread_id,
        repo_path,
        prompt,
        attachments,
        options,
    };

    // We need to run the start_run in a spawned task because it blocks on the subprocess.
    // The callbacks send messages via the channel.
    let tx_event = tx.clone();
    let tx_item = tx.clone();
    let tx_thread = tx.clone();
    let rid = run_id.clone();
    let tid = turn_id.clone();
    let rid2 = run_id.clone();
    let tid2 = turn_id.clone();
    let rid3 = run_id.clone();
    let tid3 = turn_id.clone();
    let rid4 = run_id.clone();
    let runs_finish = runs.clone();

    // Insert placeholder
    {
        let mut map = runs.lock().await;
        map.insert(
            run_id.clone(),
            RunEntry {
                turn_id: turn_id.clone(),
                handle: ActiveHandle::None,
            },
        );
    }

    tokio::spawn(async move {
        let mut callbacks = RunCallbacks {
            on_event: move |status: RunStatus, summary: Option<String>, has_diff: Option<bool>| {
                let msg = AgentMessage::RunStatus {
                    run_id: rid.clone(),
                    turn_id: tid.clone(),
                    status,
                    summary,
                    has_diff,
                    tool_thread_id: None,
                };
                let _ = tx_event.try_send(msg);
            },
            on_finish: move |_status: RunStatus| {
                let runs = runs_finish.clone();
                let rid = rid4.clone();
                tokio::spawn(async move {
                    let mut map = runs.lock().await;
                    map.remove(&rid);
                });
            },
            on_item: move |item: RunTimelineEventPayload| {
                let msg = AgentMessage::RunItem {
                    run_id: rid2.clone(),
                    turn_id: tid2.clone(),
                    item,
                };
                let _ = tx_item.try_send(msg);
            },
            on_thread_ready: move |thread_id: String| {
                let msg = AgentMessage::RunStatus {
                    run_id: rid3.clone(),
                    turn_id: tid3.clone(),
                    status: RunStatus::Running,
                    summary: None,
                    has_diff: None,
                    tool_thread_id: Some(thread_id),
                };
                let _ = tx_thread.try_send(msg);
            },
        };

        start_run(opts, &mut callbacks).await;
    });
}

async fn handle_run_interrupt(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    run_id: &str,
    turn_id: &str,
) {
    let mut map = runs.lock().await;
    if let Some(entry) = map.get_mut(run_id) {
        if entry.turn_id == turn_id {
            entry.handle.interrupt();
        } else {
            warn!("run-turn-interrupt: no matching turn for {run_id}/{turn_id}");
        }
    }
}

async fn handle_run_kill(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    run_id: &str,
    turn_id: &str,
) {
    let mut map = runs.lock().await;
    if let Some(entry) = map.get_mut(run_id) {
        if entry.turn_id == turn_id {
            entry.handle.dispose();
            map.remove(run_id);
        }
    }
}

async fn dispose_all_runs(runs: &Arc<Mutex<HashMap<String, RunEntry>>>) {
    let mut map = runs.lock().await;
    for (_id, mut entry) in map.drain() {
        entry.handle.dispose();
    }
}

// ---------------------------------------------------------------------------
// Task management
// ---------------------------------------------------------------------------

async fn handle_task_dispatch(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    task_sessions: &Arc<Mutex<HashMap<String, TaskSession>>>,
    task_runs: &Arc<Mutex<HashMap<String, TaskRunInfo>>>,
    tx: mpsc::Sender<AgentMessage>,
    task_id: &str,
    repo_path: &str,
    tool: RunTool,
    title: &str,
    prompt: &str,
    attachments: Vec<RunImageAttachmentUpload>,
) {
    // Send task-claimed
    let _ = tx
        .send(AgentMessage::TaskClaimed {
            task_id: task_id.to_string(),
            branch_name: None,
            worktree_path: None,
        })
        .await;

    // Preserve existing toolThreadId when re-dispatching after reconnection
    let existing_thread_id = {
        let sessions = task_sessions.lock().await;
        sessions
            .get(task_id)
            .and_then(|s| s.tool_thread_id.clone())
    };

    {
        let mut sessions = task_sessions.lock().await;
        sessions.insert(
            task_id.to_string(),
            TaskSession {
                tool_thread_id: existing_thread_id.clone(),
                repo_path: repo_path.to_string(),
                tool: tool.clone(),
            },
        );
    }

    if let Some(ref thread_id) = existing_thread_id {
        info!("task {task_id}: resuming session {thread_id}");
        start_task_run(
            runs,
            task_sessions,
            task_runs,
            tx,
            task_id,
            repo_path,
            tool,
            "The previous session was interrupted due to a connection issue. Please continue where you left off.",
            Some(thread_id.clone()),
            attachments,
        ).await;
        return;
    }

    let full_prompt = format!("Task: {title}\n\n{prompt}");
    start_task_run(
        runs,
        task_sessions,
        task_runs,
        tx,
        task_id,
        repo_path,
        tool,
        &full_prompt,
        None,
        attachments,
    )
    .await;
}

async fn handle_task_user_reply(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    task_sessions: &Arc<Mutex<HashMap<String, TaskSession>>>,
    task_runs: &Arc<Mutex<HashMap<String, TaskRunInfo>>>,
    tx: mpsc::Sender<AgentMessage>,
    task_id: &str,
    content: &str,
    attachments: Vec<RunImageAttachmentUpload>,
) {
    let session = {
        let sessions = task_sessions.lock().await;
        sessions.get(task_id).map(|s| {
            (
                s.repo_path.clone(),
                s.tool.clone(),
                s.tool_thread_id.clone(),
            )
        })
    };

    if let Some((repo_path, tool, tool_thread_id)) = session {
        start_task_run(
            runs,
            task_sessions,
            task_runs,
            tx,
            task_id,
            &repo_path,
            tool,
            content,
            tool_thread_id,
            attachments,
        )
        .await;
    }
}

async fn start_task_run(
    runs: &Arc<Mutex<HashMap<String, RunEntry>>>,
    task_sessions: &Arc<Mutex<HashMap<String, TaskSession>>>,
    task_runs: &Arc<Mutex<HashMap<String, TaskRunInfo>>>,
    tx: mpsc::Sender<AgentMessage>,
    task_id: &str,
    repo_path: &str,
    tool: RunTool,
    prompt: &str,
    tool_thread_id: Option<String>,
    attachments: Vec<RunImageAttachmentUpload>,
) {
    // Dispose previous run for this task
    {
        let task_map = task_runs.lock().await;
        if let Some(info) = task_map.get(task_id) {
            let mut run_map = runs.lock().await;
            if let Some(mut entry) = run_map.remove(&info.run_id) {
                entry.handle.dispose();
            }
        }
    }
    {
        let mut task_map = task_runs.lock().await;
        task_map.remove(task_id);
    }

    let run_id = Uuid::new_v4().to_string();
    let turn_id = Uuid::new_v4().to_string();

    info!(
        "task {task_id}: {}",
        if tool_thread_id.is_some() {
            format!("resuming session {}", tool_thread_id.as_deref().unwrap_or(""))
        } else {
            "new session".to_string()
        }
    );

    let opts = RunWrapperOptions {
        run_id: run_id.clone(),
        tool,
        tool_thread_id,
        repo_path: repo_path.to_string(),
        prompt: prompt.to_string(),
        attachments,
        options: RunTurnOptions {
            model: None,
            claude_effort: None,
            codex_effort: None,
            clear_session: None,
        },
    };

    // Track task run
    {
        let mut task_map = task_runs.lock().await;
        task_map.insert(
            task_id.to_string(),
            TaskRunInfo {
                run_id: run_id.clone(),
                turn_id: turn_id.clone(),
            },
        );
    }

    // Insert placeholder run entry
    {
        let mut map = runs.lock().await;
        map.insert(
            run_id.clone(),
            RunEntry {
                turn_id: turn_id.clone(),
                handle: ActiveHandle::None,
            },
        );
    }

    let tx_event = tx.clone();
    let tx_item = tx.clone();
    let tx_thread = tx.clone();
    let tx_finish = tx.clone();
    let rid = run_id.clone();
    let tid = turn_id.clone();
    let rid2 = run_id.clone();
    let tid2 = turn_id.clone();
    let rid3 = run_id.clone();
    let tid3 = turn_id.clone();
    let rid4 = run_id.clone();

    let task_id_event = task_id.to_string();
    let task_id_item = task_id.to_string();
    let task_id_thread = task_id.to_string();
    let task_id_finish = task_id.to_string();

    let runs_finish = runs.clone();
    let task_runs_finish = task_runs.clone();
    let task_sessions_thread = task_sessions.clone();

    // Step tracking for task forwarding
    let step_ids: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    let step_ids_clone = step_ids.clone();

    tokio::spawn(async move {
        let tx_task_event = tx_event.clone();
        let tx_task_finish = tx_finish.clone();
        let tx_task_item = tx_item.clone();
        let task_id_ev = task_id_event.clone();
        let task_id_fi = task_id_finish.clone();

        let mut callbacks = RunCallbacks {
            on_event: move |status: RunStatus, summary: Option<String>, has_diff: Option<bool>| {
                let msg = AgentMessage::RunStatus {
                    run_id: rid.clone(),
                    turn_id: tid.clone(),
                    status: status.clone(),
                    summary,
                    has_diff,
                    tool_thread_id: None,
                };
                let _ = tx_event.try_send(msg);

                if matches!(status, RunStatus::Running) {
                    let task_msg = AgentMessage::TaskRunning {
                        task_id: task_id_ev.clone(),
                        run_id: rid.clone(),
                        turn_id: tid.clone(),
                        branch_name: None,
                        worktree_path: None,
                    };
                    let _ = tx_task_event.try_send(task_msg);
                }
            },
            on_finish: move |final_status: RunStatus| {
                // Remove from runs
                let runs = runs_finish.clone();
                let rid = rid4.clone();
                let task_runs = task_runs_finish.clone();
                let task_id = task_id_fi.clone();
                let tx = tx_task_finish.clone();
                tokio::spawn(async move {
                    {
                        let mut map = runs.lock().await;
                        map.remove(&rid);
                    }
                    {
                        let mut map = task_runs.lock().await;
                        map.remove(&task_id);
                    }

                    if matches!(final_status, RunStatus::Success) {
                        let _ = tx
                            .send(AgentMessage::TaskWaiting {
                                task_id,
                            })
                            .await;
                    } else {
                        let error = if matches!(final_status, RunStatus::Interrupted) {
                            "Run interrupted"
                        } else {
                            "Run failed"
                        };
                        let _ = tx
                            .send(AgentMessage::TaskFailed {
                                task_id,
                                error: error.to_string(),
                            })
                            .await;
                    }
                });
            },
            on_item: move |item: RunTimelineEventPayload| {
                // Forward to run-item
                let msg = AgentMessage::RunItem {
                    run_id: rid2.clone(),
                    turn_id: tid2.clone(),
                    item: item.clone(),
                };
                let _ = tx_item.try_send(msg);

                // Forward to task timeline
                let task_id = task_id_item.clone();
                let tx = tx_task_item.clone();
                let step_ids = step_ids_clone.clone();
                tokio::spawn(async move {
                    forward_run_item_to_task(&tx, &task_id, &item, &step_ids).await;
                });
            },
            on_thread_ready: move |thread_id: String| {
                // Update task session
                let sessions = task_sessions_thread.clone();
                let tid_clone = task_id_thread.clone();
                let thread_clone = thread_id.clone();
                tokio::spawn(async move {
                    let mut map = sessions.lock().await;
                    if let Some(session) = map.get_mut(&tid_clone) {
                        session.tool_thread_id = Some(thread_clone);
                    }
                });

                info!("task {}: session ready {}", task_id_thread, thread_id);
                let msg = AgentMessage::RunStatus {
                    run_id: rid3.clone(),
                    turn_id: tid3.clone(),
                    status: RunStatus::Running,
                    summary: None,
                    has_diff: None,
                    tool_thread_id: Some(thread_id),
                };
                let _ = tx_thread.try_send(msg);
            },
        };

        start_run(opts, &mut callbacks).await;
    });
}

/// Forward a run timeline item to the task conversation timeline.
async fn forward_run_item_to_task(
    tx: &mpsc::Sender<AgentMessage>,
    task_id: &str,
    item: &RunTimelineEventPayload,
    step_ids: &Arc<Mutex<HashMap<String, String>>>,
) {
    let now = chrono_now_millis();

    match item {
        RunTimelineEventPayload::Message { role, text } => {
            if matches!(role, MessageRole::Assistant) && !text.is_empty() {
                let _ = tx
                    .send(AgentMessage::TaskMessage {
                        task_id: task_id.to_string(),
                        message: AgentTaskMessagePayload {
                            id: Uuid::new_v4().to_string(),
                            role: "agent".to_string(),
                            content: text.clone(),
                            created_at: now,
                        },
                    })
                    .await;
            }
        }
        RunTimelineEventPayload::Command {
            status,
            command,
            output,
            exit_code: _,
        } => {
            let mut map = step_ids.lock().await;
            let step_id = match status {
                CommandStatus::Started => {
                    let sid = Uuid::new_v4().to_string();
                    map.insert(command.clone(), sid.clone());
                    let _ = tx
                        .send(AgentMessage::TaskStepUpdate {
                            task_id: task_id.to_string(),
                            step: TaskStepWithoutTaskId {
                                id: sid,
                                step_type: StepType::Command,
                                label: command.clone(),
                                status: StepStatus::Running,
                                detail: None,
                                tool_name: "command".to_string(),
                                run_id: None,
                                duration_ms: None,
                                created_at: now,
                                completed_at: None,
                            },
                        })
                        .await;
                    return;
                }
                _ => {
                    let sid = map
                        .remove(command)
                        .unwrap_or_else(|| Uuid::new_v4().to_string());
                    sid
                }
            };

            let step_status = if matches!(status, CommandStatus::Completed) {
                StepStatus::Completed
            } else {
                StepStatus::Failed
            };

            let detail = if output.is_empty() {
                None
            } else {
                // Truncate to 500 chars like the TS version
                Some(output.chars().take(500).collect())
            };

            let _ = tx
                .send(AgentMessage::TaskStepUpdate {
                    task_id: task_id.to_string(),
                    step: TaskStepWithoutTaskId {
                        id: step_id,
                        step_type: StepType::Command,
                        label: command.clone(),
                        status: step_status,
                        detail,
                        tool_name: "command".to_string(),
                        run_id: None,
                        duration_ms: None,
                        created_at: now,
                        completed_at: Some(now),
                    },
                })
                .await;
        }
        RunTimelineEventPayload::Activity {
            status,
            label,
            detail,
        } => {
            let step_status = if matches!(status, RunTimelineEventStatus::Error) {
                StepStatus::Failed
            } else {
                StepStatus::Completed
            };

            let _ = tx
                .send(AgentMessage::TaskStepUpdate {
                    task_id: task_id.to_string(),
                    step: TaskStepWithoutTaskId {
                        id: Uuid::new_v4().to_string(),
                        step_type: StepType::Think,
                        label: label.clone(),
                        status: step_status,
                        detail: detail.clone(),
                        tool_name: "activity".to_string(),
                        run_id: None,
                        duration_ms: None,
                        created_at: now,
                        completed_at: Some(now),
                    },
                })
                .await;
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_ws_url(server_url: &str) -> String {
    let base = server_url.trim_end_matches('/');
    let ws_base = if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else if base.starts_with("http://") {
        base.replacen("http://", "ws://", 1)
    } else {
        format!("ws://{base}")
    };
    format!("{ws_base}/ws/agent")
}

fn chrono_now_millis() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}
