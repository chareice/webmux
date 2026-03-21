use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::error;

use webmux_shared::{
    AgentMessage, RepositoryBrowseResultPayload, Run,
    RunEvent, RunTimelineEventPayload, RunTool,
    ServerToAgentMessage, Task, TaskMessage as SharedTaskMessage, TaskMessageRole, TaskStatus,
    TaskStep as SharedTaskStep,
};

use crate::db::types::{RunRow, TaskRow};
use crate::db::DbPool;

// ---------------------------------------------------------------------------
// OnlineAgent — represents a connected agent
// ---------------------------------------------------------------------------

struct OnlineAgent {
    user_id: String,
    #[allow(dead_code)]
    name: String,
    tx: mpsc::UnboundedSender<String>,
}

// ---------------------------------------------------------------------------
// Client senders for browser WebSocket connections
// ---------------------------------------------------------------------------

/// A unique id for each browser WS connection so we can store them in sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ClientId(u64);

struct BrowserClient {
    tx: mpsc::UnboundedSender<String>,
}

// ---------------------------------------------------------------------------
// PendingCommand — for request/response patterns (e.g. repository-browse)
// ---------------------------------------------------------------------------

struct PendingCommand {
    agent_id: String,
    resolve: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
}

// ---------------------------------------------------------------------------
// AgentHub
// ---------------------------------------------------------------------------

pub struct AgentHub {
    agents: HashMap<String, OnlineAgent>,
    run_clients: HashMap<String, HashMap<ClientId, BrowserClient>>,
    project_clients: HashMap<String, HashMap<ClientId, BrowserClient>>,
    pending_commands: HashMap<String, PendingCommand>,
    next_client_id: u64,
}

impl AgentHub {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            run_clients: HashMap::new(),
            project_clients: HashMap::new(),
            pending_commands: HashMap::new(),
            next_client_id: 1,
        }
    }

    /// Allocate a unique ClientId for a browser WS connection.
    pub fn next_client_id(&mut self) -> ClientId {
        let id = ClientId(self.next_client_id);
        self.next_client_id += 1;
        id
    }

    // -----------------------------------------------------------------------
    // Agent management
    // -----------------------------------------------------------------------

    /// Register an authenticated agent. Returns the previous sender if this
    /// agent was already connected (caller should close the old connection).
    pub fn register_agent(
        &mut self,
        agent_id: &str,
        user_id: &str,
        name: &str,
        tx: mpsc::UnboundedSender<String>,
    ) -> Option<mpsc::UnboundedSender<String>> {
        let old = self.agents.remove(agent_id).map(|a| a.tx);
        self.agents.insert(
            agent_id.to_string(),
            OnlineAgent {
                user_id: user_id.to_string(),
                name: name.to_string(),
                tx,
            },
        );
        old
    }

    /// Check whether an agent is online.
    pub fn is_agent_online(&self, agent_id: &str) -> bool {
        self.agents.contains_key(agent_id)
    }

    /// Send a message to a connected agent. Returns false if agent is not online.
    pub fn send_to_agent(&self, agent_id: &str, message: &ServerToAgentMessage) -> bool {
        if let Some(agent) = self.agents.get(agent_id) {
            let json = match serde_json::to_string(message) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize message for agent {}: {}", agent_id, e);
                    return false;
                }
            };
            agent.tx.send(json).is_ok()
        } else {
            false
        }
    }

    /// Remove an agent from the online set. Returns user_id if agent was online.
    pub fn remove_agent(&mut self, agent_id: &str) -> Option<String> {
        // Reject any pending commands for this agent
        let pending_ids: Vec<String> = self
            .pending_commands
            .iter()
            .filter(|(_, v)| v.agent_id == agent_id)
            .map(|(k, _)| k.clone())
            .collect();
        for request_id in pending_ids {
            if let Some(cmd) = self.pending_commands.remove(&request_id) {
                let _ = cmd.resolve.send(Err("Agent disconnected".to_string()));
            }
        }

        self.agents.remove(agent_id).map(|a| a.user_id)
    }

    // -----------------------------------------------------------------------
    // Run client management
    // -----------------------------------------------------------------------

    /// Register a browser client watching a run.
    pub fn add_run_client(
        &mut self,
        run_id: &str,
        client_id: ClientId,
        tx: mpsc::UnboundedSender<String>,
    ) {
        let clients = self
            .run_clients
            .entry(run_id.to_string())
            .or_default();
        clients.insert(client_id, BrowserClient { tx });
    }

    /// Remove a browser client watching a run.
    pub fn remove_run_client(&mut self, run_id: &str, client_id: ClientId) {
        if let Some(clients) = self.run_clients.get_mut(run_id) {
            clients.remove(&client_id);
            if clients.is_empty() {
                self.run_clients.remove(run_id);
            }
        }
    }

    /// Broadcast a RunEvent to all browser clients watching a run.
    pub fn broadcast_to_run(&self, run_id: &str, event: &RunEvent) {
        if let Some(clients) = self.run_clients.get(run_id) {
            let json = match serde_json::to_string(event) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize run event: {}", e);
                    return;
                }
            };
            for client in clients.values() {
                let _ = client.tx.send(json.clone());
            }
        }
    }

    // -----------------------------------------------------------------------
    // Project client management
    // -----------------------------------------------------------------------

    /// Register a browser client watching a project.
    pub fn add_project_client(
        &mut self,
        project_id: &str,
        client_id: ClientId,
        tx: mpsc::UnboundedSender<String>,
    ) {
        let clients = self
            .project_clients
            .entry(project_id.to_string())
            .or_default();
        clients.insert(client_id, BrowserClient { tx });
    }

    /// Remove a browser client watching a project.
    pub fn remove_project_client(&mut self, project_id: &str, client_id: ClientId) {
        if let Some(clients) = self.project_clients.get_mut(project_id) {
            clients.remove(&client_id);
            if clients.is_empty() {
                self.project_clients.remove(project_id);
            }
        }
    }

    /// Broadcast a RunEvent to all browser clients watching a project.
    pub fn broadcast_to_project(&self, project_id: &str, event: &RunEvent) {
        if let Some(clients) = self.project_clients.get(project_id) {
            let json = match serde_json::to_string(event) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize project event: {}", e);
                    return;
                }
            };
            for client in clients.values() {
                let _ = client.tx.send(json.clone());
            }
        }
    }

    // -----------------------------------------------------------------------
    // Pending command management (repository-browse)
    // -----------------------------------------------------------------------

    /// Register a pending command and return the request_id.
    pub fn register_pending_command(
        &mut self,
        request_id: String,
        agent_id: &str,
        resolve: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
    ) {
        self.pending_commands.insert(
            request_id,
            PendingCommand {
                agent_id: agent_id.to_string(),
                resolve,
            },
        );
    }

    /// Resolve a pending command.
    pub fn resolve_pending_command(
        &mut self,
        request_id: &str,
        result: Result<serde_json::Value, String>,
    ) -> bool {
        if let Some(cmd) = self.pending_commands.remove(request_id) {
            let _ = cmd.resolve.send(result);
            true
        } else {
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Helper conversion functions
// ---------------------------------------------------------------------------

pub fn run_row_to_run(row: &RunRow) -> Run {
    Run {
        id: row.id.clone(),
        agent_id: row.agent_id.clone(),
        tool: serde_json::from_str(&format!("\"{}\"", row.tool))
            .unwrap_or(RunTool::Claude),
        repo_path: row.repo_path.clone(),
        branch: row.branch.clone(),
        prompt: row.prompt.clone(),
        status: serde_json::from_str(&format!("\"{}\"", row.status))
            .unwrap_or(webmux_shared::RunStatus::Failed),
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
        summary: row.summary.clone(),
        has_diff: row.has_diff == 1,
        unread: row.unread == 1,
    }
}

pub fn task_row_to_task(row: &TaskRow) -> Task {
    let tool_str = row.tool.as_deref().unwrap_or("claude");
    Task {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        title: row.title.clone(),
        prompt: row.prompt.clone(),
        tool: serde_json::from_str(&format!("\"{}\"", tool_str))
            .unwrap_or(RunTool::Claude),
        status: serde_json::from_str(&format!("\"{}\"", row.status))
            .unwrap_or(TaskStatus::Pending),
        priority: row.priority,
        branch_name: row.branch_name.clone(),
        worktree_path: row.worktree_path.clone(),
        run_id: row.run_id.clone(),
        error_message: row.error_message.clone(),
        summary: row.summary.clone(),
        attachments: None,
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
        claimed_at: row.claimed_at.map(|v| v as f64),
        completed_at: row.completed_at.map(|v| v as f64),
    }
}

fn is_active_run_status(status: &str) -> bool {
    status == "starting" || status == "running"
}

fn is_terminal_run_status(status: &str) -> bool {
    status == "success" || status == "failed" || status == "interrupted"
}

// ---------------------------------------------------------------------------
// Message handling — called from the WS read loop
// ---------------------------------------------------------------------------

/// Process an agent message. This is the main dispatch function.
/// Called with write-lock already held on the hub.
pub fn handle_agent_message(
    hub: &mut AgentHub,
    db: &DbPool,
    agent_id: &str,
    message: AgentMessage,
) {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    match message {
        AgentMessage::Heartbeat {} => {
            let _ = crate::db::agents::update_agent_last_seen(&conn, agent_id);
            // Heartbeat timer reset is handled externally
        }

        AgentMessage::RepositoryBrowseResult(payload) => {
            handle_repository_browse_result(hub, payload);
        }

        AgentMessage::Error { message: msg } => {
            error!("[agent-hub] Agent {} error: {}", agent_id, msg);
        }

        AgentMessage::RunStatus {
            run_id,
            turn_id,
            status,
            summary,
            has_diff,
            tool_thread_id,
        } => {
            handle_run_status(
                hub,
                &conn,
                agent_id,
                &run_id,
                &turn_id,
                &status,
                summary.as_deref(),
                has_diff,
                tool_thread_id.as_deref(),
            );
        }

        AgentMessage::RunItem {
            run_id,
            turn_id,
            item,
        } => {
            handle_run_item(hub, &conn, agent_id, &run_id, &turn_id, &item);
        }

        AgentMessage::TaskClaimed {
            task_id,
            branch_name,
            worktree_path,
        } => {
            handle_task_claimed(hub, &conn, &task_id, branch_name.as_deref(), worktree_path.as_deref());
        }

        AgentMessage::TaskRunning {
            task_id,
            run_id,
            turn_id,
            branch_name,
            worktree_path,
        } => {
            handle_task_running(
                hub, &conn, &task_id, &run_id, &turn_id,
                branch_name.as_deref(), worktree_path.as_deref(),
            );
        }

        AgentMessage::TaskCompleted { task_id, summary } => {
            handle_task_completed(hub, &conn, &task_id, &summary);
        }

        AgentMessage::TaskFailed { task_id, error } => {
            handle_task_failed(hub, &conn, &task_id, &error);
        }

        AgentMessage::TaskStepUpdate { task_id, step } => {
            handle_task_step_update(hub, &conn, &task_id, &step);
        }

        AgentMessage::TaskMessage { task_id, message: msg } => {
            handle_task_message(hub, &conn, &task_id, &msg);
        }

        AgentMessage::TaskWaiting { task_id } => {
            let _ = crate::db::tasks::update_task_status(&conn, &task_id, "waiting", None);
            broadcast_task_snapshot(hub, &conn, &task_id);
        }

        // Auth is handled before this dispatch; ignore here
        AgentMessage::Auth { .. } => {}
    }
}

// ---------------------------------------------------------------------------
// Individual message handlers
// ---------------------------------------------------------------------------

fn handle_repository_browse_result(
    hub: &mut AgentHub,
    payload: RepositoryBrowseResultPayload,
) {
    match payload {
        RepositoryBrowseResultPayload::Ok {
            request_id,
            current_path,
            parent_path,
            entries,
            ..
        } => {
            let result = serde_json::json!({
                "currentPath": current_path,
                "parentPath": parent_path,
                "entries": entries,
            });
            hub.resolve_pending_command(&request_id, Ok(result));
        }
        RepositoryBrowseResultPayload::Err {
            request_id,
            error,
            ..
        } => {
            hub.resolve_pending_command(&request_id, Err(error));
        }
    }
}

fn handle_run_status(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    agent_id: &str,
    run_id: &str,
    turn_id: &str,
    status: &webmux_shared::RunStatus,
    summary: Option<&str>,
    has_diff: Option<bool>,
    tool_thread_id: Option<&str>,
) {
    let run_row = match crate::db::runs::find_run_by_id(conn, run_id) {
        Ok(Some(r)) => r,
        _ => return,
    };
    let turn_row = match crate::db::runs::find_run_turn_by_id(conn, turn_id) {
        Ok(Some(t)) => t,
        _ => return,
    };

    // Verify ownership
    if run_row.agent_id != agent_id || turn_row.run_id != run_id {
        return;
    }

    if let Some(tid) = tool_thread_id {
        let _ = crate::db::runs::update_run_tool_thread_id(conn, run_id, tid);
    }

    let was_active = is_active_run_status(&turn_row.status);
    let status_str = serde_json::to_string(status)
        .unwrap_or_else(|_| "\"failed\"".to_string())
        .trim_matches('"')
        .to_string();

    let _ = crate::db::runs::update_run_turn_status(
        conn,
        turn_id,
        &status_str,
        summary,
        has_diff,
    );

    broadcast_run_snapshot(hub, conn, run_id, Some(turn_id));

    if was_active && is_terminal_run_status(&status_str) {
        // Auto-dispatch next queued turn (skip if interrupted)
        if status_str != "interrupted" {
            dispatch_next_queued_turn(hub, conn, agent_id, run_id);
        }
    }
}

fn handle_run_item(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    agent_id: &str,
    run_id: &str,
    turn_id: &str,
    item: &RunTimelineEventPayload,
) {
    let owned_run = match crate::db::runs::find_run_by_id(conn, run_id) {
        Ok(Some(r)) => r,
        _ => return,
    };
    let turn_row = match crate::db::runs::find_run_turn_by_id(conn, turn_id) {
        Ok(Some(t)) => t,
        _ => return,
    };
    if owned_run.agent_id != agent_id || turn_row.run_id != run_id {
        return;
    }

    let event = match crate::db::runs::append_run_timeline_event(conn, run_id, turn_id, item) {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to append timeline event: {}", e);
            return;
        }
    };

    let run_event = RunEvent::RunItem {
        run_id: run_id.to_string(),
        turn_id: turn_id.to_string(),
        item: event,
    };
    hub.broadcast_to_run(run_id, &run_event);
}

fn handle_task_claimed(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    branch_name: Option<&str>,
    worktree_path: Option<&str>,
) {
    // Verify task exists
    if crate::db::tasks::find_task_by_id(conn, task_id).ok().flatten().is_none() {
        return;
    }

    if let (Some(bn), Some(wp)) = (branch_name, worktree_path) {
        let _ = crate::db::tasks::update_task_worktree_info(conn, task_id, bn, wp);
    }

    broadcast_task_snapshot(hub, conn, task_id);
}

fn handle_task_running(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    run_id: &str,
    turn_id: &str,
    branch_name: Option<&str>,
    worktree_path: Option<&str>,
) {
    let task = match crate::db::tasks::find_task_by_id(conn, task_id) {
        Ok(Some(t)) => t,
        _ => return,
    };

    // Create run record if it doesn't exist
    if !run_id.is_empty() {
        let existing_run = crate::db::runs::find_run_by_id(conn, run_id);
        if matches!(existing_run, Ok(None)) {
            let project = crate::db::projects::find_project_by_id(conn, &task.project_id);
            if let Ok(Some(project)) = project {
                let _ = crate::db::runs::create_run_with_initial_turn(
                    conn,
                    crate::db::runs::CreateRunWithInitialTurnOpts {
                        run_id,
                        turn_id,
                        agent_id: &project.agent_id,
                        user_id: &project.user_id,
                        tool: &project.default_tool,
                        repo_path: &project.repo_path,
                        prompt: &task.prompt,
                        branch: None,
                        attachments: None,
                    },
                );
            }
        }
    }

    let _ = crate::db::tasks::update_task_status(conn, task_id, "running", None);
    let _ = crate::db::tasks::update_task_run_info(conn, task_id, run_id);

    if let (Some(bn), Some(wp)) = (branch_name, worktree_path) {
        let _ = crate::db::tasks::update_task_worktree_info(conn, task_id, bn, wp);
    }

    broadcast_task_snapshot(hub, conn, task_id);
}

fn handle_task_completed(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    summary: &str,
) {
    let _ = crate::db::tasks::update_task_status(conn, task_id, "completed", None);
    let _ = crate::db::tasks::update_task_summary(conn, task_id, summary);
    broadcast_task_snapshot(hub, conn, task_id);
}

fn handle_task_failed(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    error: &str,
) {
    let _ = crate::db::tasks::update_task_status(
        conn,
        task_id,
        "failed",
        Some(Some(error)),
    );
    broadcast_task_snapshot(hub, conn, task_id);
}

fn handle_task_step_update(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    step: &webmux_shared::TaskStepWithoutTaskId,
) {
    let status_str = serde_json::to_string(&step.status)
        .unwrap_or_else(|_| "\"running\"".to_string())
        .trim_matches('"')
        .to_string();

    let step_type_str = serde_json::to_string(&step.step_type)
        .unwrap_or_else(|_| "\"think\"".to_string())
        .trim_matches('"')
        .to_string();

    if status_str == "running" {
        // Create new step record
        let _ = crate::db::tasks::create_task_step(
            conn,
            crate::db::tasks::CreateTaskStepOpts {
                id: Some(&step.id),
                task_id,
                step_type: &step_type_str,
                label: &step.label,
                tool_name: &step.tool_name,
                status: Some("running"),
                detail: step.detail.as_deref(),
                run_id: step.run_id.as_deref(),
                created_at: Some(step.created_at as i64),
            },
        );
    } else {
        // Update existing step (completed or failed)
        let _ = crate::db::tasks::update_task_step(
            conn,
            &step.id,
            crate::db::tasks::UpdateTaskStepOpts {
                status: Some(&status_str),
                detail: step.detail.as_deref(),
                run_id: step.run_id.as_deref(),
                duration_ms: step.duration_ms.map(|v| v as i64),
                completed_at: step.completed_at.map(|v| v as i64),
            },
        );
    }

    // Broadcast step update to project clients
    broadcast_step_update(hub, conn, task_id, step);
}

fn handle_task_message(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    msg: &webmux_shared::AgentTaskMessagePayload,
) {
    // Store the message in DB
    let _ = crate::db::tasks::create_task_message(
        conn,
        task_id,
        &msg.role,
        &msg.content,
        Some(&msg.id),
    );

    // Broadcast to web clients
    let task = match crate::db::tasks::find_task_by_id(conn, task_id) {
        Ok(Some(t)) => t,
        _ => return,
    };

    let clients = hub.project_clients.get(&task.project_id);
    if clients.map_or(true, |c| c.is_empty()) {
        return;
    }

    let role = match msg.role.as_str() {
        "agent" => TaskMessageRole::Agent,
        "user" => TaskMessageRole::User,
        _ => TaskMessageRole::Agent,
    };

    let task_message = SharedTaskMessage {
        id: msg.id.clone(),
        task_id: task_id.to_string(),
        role,
        content: msg.content.clone(),
        created_at: msg.created_at,
    };

    let event = RunEvent::TaskMessage {
        task_id: task_id.to_string(),
        message: task_message,
    };

    hub.broadcast_to_project(&task.project_id, &event);
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/// Broadcast a run snapshot (run-status + run-turn) to all watching browsers.
pub fn broadcast_run_snapshot(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    run_id: &str,
    turn_id: Option<&str>,
) {
    let run_row = match crate::db::runs::find_run_by_id(conn, run_id) {
        Ok(Some(r)) => r,
        _ => return,
    };

    let status_event = RunEvent::RunStatus {
        run: run_row_to_run(&run_row),
    };
    hub.broadcast_to_run(run_id, &status_event);

    let target_turn = if let Some(tid) = turn_id {
        crate::db::runs::find_run_turn_by_id(conn, tid).ok().flatten()
    } else {
        crate::db::runs::find_latest_run_turn_by_run_id(conn, run_id)
            .ok()
            .flatten()
    };

    if let Some(turn) = target_turn {
        let run_turn = crate::db::runs::run_turn_row_to_run_turn(&turn, vec![]);
        let turn_event = RunEvent::RunTurn {
            run_id: run_id.to_string(),
            turn: run_turn,
        };
        hub.broadcast_to_run(run_id, &turn_event);
    }
}

/// Broadcast a task snapshot to all project watchers.
pub fn broadcast_task_snapshot(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
) {
    let task_row = match crate::db::tasks::find_task_by_id(conn, task_id) {
        Ok(Some(t)) => t,
        _ => return,
    };

    let event = RunEvent::TaskStatus {
        task: task_row_to_task(&task_row),
    };

    hub.broadcast_to_project(&task_row.project_id, &event);
}

fn broadcast_step_update(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    step: &webmux_shared::TaskStepWithoutTaskId,
) {
    let task = match crate::db::tasks::find_task_by_id(conn, task_id) {
        Ok(Some(t)) => t,
        _ => return,
    };

    let clients = hub.project_clients.get(&task.project_id);
    if clients.map_or(true, |c| c.is_empty()) {
        return;
    }

    let full_step = SharedTaskStep {
        id: step.id.clone(),
        task_id: task_id.to_string(),
        step_type: step.step_type.clone(),
        label: step.label.clone(),
        status: step.status.clone(),
        detail: step.detail.clone(),
        tool_name: step.tool_name.clone(),
        run_id: step.run_id.clone(),
        duration_ms: step.duration_ms,
        created_at: step.created_at,
        completed_at: step.completed_at,
    };

    let event = RunEvent::TaskStep {
        task_id: task_id.to_string(),
        step: full_step,
    };

    hub.broadcast_to_project(&task.project_id, &event);
}

// ---------------------------------------------------------------------------
// Queued turn dispatch
// ---------------------------------------------------------------------------

fn dispatch_next_queued_turn(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    agent_id: &str,
    run_id: &str,
) -> bool {
    let queued = match crate::db::runs::find_queued_run_turns_by_run_id(conn, run_id) {
        Ok(q) => q,
        Err(_) => return false,
    };
    if queued.is_empty() {
        return false;
    }

    let next = &queued[0];
    let run_row = match crate::db::runs::find_run_by_id(conn, run_id) {
        Ok(Some(r)) => r,
        _ => return false,
    };

    // Promote queued -> starting
    let _ = crate::db::runs::update_run_turn_status(conn, &next.id, "starting", None, None);

    let msg = ServerToAgentMessage::RunTurnStart {
        run_id: run_id.to_string(),
        turn_id: next.id.clone(),
        tool: serde_json::from_str(&format!("\"{}\"", run_row.tool))
            .unwrap_or(RunTool::Claude),
        repo_path: run_row.repo_path.clone(),
        prompt: next.prompt.clone(),
        tool_thread_id: run_row.tool_thread_id.clone(),
        attachments: None,
        options: None,
    };

    if !hub.send_to_agent(agent_id, &msg) {
        // Agent went offline; revert to queued
        let _ = crate::db::runs::update_run_turn_status(conn, &next.id, "queued", None, None);
        return false;
    }

    broadcast_run_snapshot(hub, conn, run_id, Some(&next.id));
    true
}

/// Dispatch the next queued turn for a run. Public version for use from handlers.
pub fn dispatch_next_queued_turn_pub(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    agent_id: &str,
    run_id: &str,
) -> bool {
    dispatch_next_queued_turn(hub, conn, agent_id, run_id)
}

// ---------------------------------------------------------------------------
// Agent disconnect cleanup
// ---------------------------------------------------------------------------

/// Clean up when an agent disconnects: fail active runs/turns, reset tasks.
pub fn on_agent_disconnect(
    hub: &mut AgentHub,
    db: &DbPool,
    agent_id: &str,
) {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get DB connection on disconnect: {}", e);
            return;
        }
    };

    // Remove from online set
    let _user_id = hub.remove_agent(agent_id);

    // Mark agent offline
    let _ = crate::db::agents::update_agent_status(&conn, agent_id, "offline");

    // Fail active runs
    if let Ok(active_runs) = crate::db::runs::find_active_runs_by_agent_id(&conn, agent_id) {
        for run in &active_runs {
            let active_turn =
                crate::db::runs::find_active_run_turn_by_run_id(&conn, &run.id).ok().flatten();

            if let Some(turn) = &active_turn {
                let summary = "Agent disconnected before the run completed.";
                let _ = crate::db::runs::update_run_turn_status(
                    &conn,
                    &turn.id,
                    "failed",
                    Some(summary),
                    None,
                );
            } else {
                let _ = crate::db::runs::update_run_status(
                    &conn,
                    &run.id,
                    "failed",
                    Some("Agent disconnected before the run completed."),
                    None,
                );
            }

            broadcast_run_snapshot(hub, &conn, &run.id, active_turn.as_ref().map(|t| t.id.as_str()));
        }
    }

    // Reset dispatched/running tasks back to pending
    let active_task_ids: Vec<String> = conn
        .prepare(
            "SELECT t.id FROM tasks t
             JOIN projects p ON t.project_id = p.id
             WHERE p.agent_id = ? AND t.status IN ('dispatched', 'running')",
        )
        .and_then(|mut stmt| {
            let rows = stmt.query_map(rusqlite::params![agent_id], |row| {
                row.get::<_, String>(0)
            })?;
            rows.collect()
        })
        .unwrap_or_default();

    for task_id in &active_task_ids {
        // Pass Some(None) to explicitly clear any stale error_message
        let _ = crate::db::tasks::update_task_status(
            &conn,
            task_id,
            "pending",
            Some(None),
        );
    }
}

/// Send a user reply to the agent for a waiting task.
pub fn send_user_reply_to_agent(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    task_id: &str,
    attachments: Option<Vec<webmux_shared::RunImageAttachmentUpload>>,
) {
    let task = match crate::db::tasks::find_task_by_id(conn, task_id) {
        Ok(Some(t)) => t,
        _ => return,
    };
    let project = match crate::db::projects::find_project_by_id(conn, &task.project_id) {
        Ok(Some(p)) => p,
        _ => return,
    };
    let messages = match crate::db::tasks::find_messages_by_task_id(conn, task_id) {
        Ok(m) => m,
        Err(_) => return,
    };

    let last_user_msg = messages.iter().rev().find(|m| m.role == "user");
    let Some(last_user_msg) = last_user_msg else {
        return;
    };

    let msg = ServerToAgentMessage::TaskUserReply {
        task_id: task_id.to_string(),
        content: last_user_msg.content.clone(),
        attachments,
    };

    hub.send_to_agent(&project.agent_id, &msg);
}
