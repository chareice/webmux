use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use webmux_shared::{AgentMessage, ServerToAgentMessage};

use crate::auth::verify_jwt;
use crate::state::AppState;
use crate::ws::agent_hub::{self, run_row_to_run};
use crate::ws::task_dispatcher;

// ---------------------------------------------------------------------------
// Agent WebSocket endpoint — /ws/agent
// ---------------------------------------------------------------------------

pub async fn ws_agent_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_agent_ws(socket, state))
}

async fn handle_agent_ws(socket: WebSocket, state: AppState) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Create a channel for sending messages to the agent
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Spawn the writer task
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    let agent_id: String;

    // Auth timeout
    let auth_timeout = tokio::time::sleep(std::time::Duration::from_secs(10));
    tokio::pin!(auth_timeout);

    // Phase 1: Wait for auth message
    loop {
        tokio::select! {
            _ = &mut auth_timeout => {
                let msg = ServerToAgentMessage::AuthFail {
                    message: "Authentication timeout".to_string(),
                };
                let _ = tx.send(serde_json::to_string(&msg).unwrap_or_default());
                drop(tx);
                let _ = write_task.await;
                return;
            }
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let parsed: AgentMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(_) => continue,
                        };

                        if let AgentMessage::Auth {
                            agent_id: aid,
                            agent_secret,
                            version,
                        } = parsed
                        {
                            match authenticate_agent(
                                &state,
                                &tx,
                                &aid,
                                &agent_secret,
                                version.as_deref(),
                            )
                            .await
                            {
                                Ok(true) => {
                                    agent_id = aid;
                                    break;
                                }
                                Ok(false) => {
                                    // Auth failed, message already sent
                                    drop(tx);
                                    let _ = write_task.await;
                                    return;
                                }
                                Err(e) => {
                                    error!("Auth error: {}", e);
                                    let msg = ServerToAgentMessage::AuthFail {
                                        message: "Internal error".to_string(),
                                    };
                                    let _ = tx.send(serde_json::to_string(&msg).unwrap_or_default());
                                    drop(tx);
                                    let _ = write_task.await;
                                    return;
                                }
                            }
                        } else {
                            let msg = ServerToAgentMessage::AuthFail {
                                message: "Must authenticate first".to_string(),
                            };
                            let _ = tx.send(serde_json::to_string(&msg).unwrap_or_default());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        drop(tx);
                        let _ = write_task.await;
                        return;
                    }
                    _ => continue,
                }
            }
        }
    }

    // Phase 2: Heartbeat monitoring + message processing
    let heartbeat_duration = std::time::Duration::from_secs(60);
    let mut heartbeat_deadline = tokio::time::Instant::now() + heartbeat_duration;

    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(heartbeat_deadline) => {
                warn!("Agent {} heartbeat timeout, marking offline", agent_id);
                break;
            }
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let parsed: AgentMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                warn!("Failed to parse agent message: {}", e);
                                continue;
                            }
                        };

                        // Reset heartbeat on any message
                        if matches!(parsed, AgentMessage::Heartbeat {}) {
                            heartbeat_deadline = tokio::time::Instant::now() + heartbeat_duration;
                        }

                        // Process message under write lock
                        let mut hub = state.hub.write().await;
                        agent_hub::handle_agent_message(&mut hub, &state.db, &agent_id, parsed);
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Err(e)) => {
                        warn!("Agent {} WebSocket error: {}", agent_id, e);
                        break;
                    }
                    _ => continue,
                }
            }
        }
    }

    // Agent disconnected — clean up
    info!("Agent {} disconnected", agent_id);
    {
        let mut hub = state.hub.write().await;
        agent_hub::on_agent_disconnect(&mut hub, &state.db, &agent_id);
    }

    drop(tx);
    let _ = write_task.await;
}

/// Authenticate an agent: verify credentials, register in hub, send auth-ok.
async fn authenticate_agent(
    state: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    agent_id: &str,
    agent_secret: &str,
    version: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let db = state.db.clone();
    let agent_id_owned = agent_id.to_string();
    let agent_secret_owned = agent_secret.to_string();

    // DB lookup + bcrypt verify in blocking task
    let (agent_row, valid) = {
        let conn = db.get()?;
        let agent = crate::db::agents::find_agent_by_id(&conn, &agent_id_owned)?;
        let agent = match agent {
            Some(a) => a,
            None => {
                let msg = ServerToAgentMessage::AuthFail {
                    message: "Agent not found".to_string(),
                };
                let _ = tx.send(serde_json::to_string(&msg)?);
                return Ok(false);
            }
        };
        let valid = crate::auth::verify_password(&agent_secret_owned, &agent.agent_secret_hash);
        (agent, valid)
    };

    if !valid {
        let msg = ServerToAgentMessage::AuthFail {
            message: "Invalid credentials".to_string(),
        };
        let _ = tx.send(serde_json::to_string(&msg)?);
        return Ok(false);
    }

    // Check minimum version
    if let (Some(min_version), Some(_pkg_name)) = (
        state.config.agent_min_version.as_deref(),
        state.config.agent_package_name.as_deref(),
    ) {
        if is_below_minimum_version(version, min_version) {
            let msg = ServerToAgentMessage::AuthFail {
                message: format!(
                    "Agent version is below minimum required version {}. Please update.",
                    min_version
                ),
            };
            let _ = tx.send(serde_json::to_string(&msg)?);
            return Ok(false);
        }
    }

    // Disconnect existing connection if agent is already online
    let mut hub = state.hub.write().await;
    let old_tx = hub.register_agent(
        &agent_id_owned,
        &agent_row.user_id,
        &agent_row.name,
        tx.clone(),
    );
    if let Some(old) = old_tx {
        // Drop the old sender; the old write_task will finish
        drop(old);
    }

    // Update DB status
    {
        let conn = db.get()?;
        let _ = crate::db::agents::update_agent_status(&conn, &agent_id_owned, "online");
        let _ = crate::db::agents::update_agent_last_seen(&conn, &agent_id_owned);
    }

    // Build upgrade policy
    let upgrade_policy = build_upgrade_policy(
        state.config.agent_package_name.as_deref(),
        state.config.agent_target_version.as_deref(),
        state.config.agent_min_version.as_deref(),
    );

    let msg = ServerToAgentMessage::AuthOk {
        upgrade_policy,
    };
    let _ = tx.send(serde_json::to_string(&msg)?);

    // Dispatch pending tasks for this agent (needs hub still locked)
    let db_clone = state.db.clone();
    let aid = agent_id_owned.clone();
    task_dispatcher::dispatch_pending_tasks_for_agent(&hub, &db_clone, &aid);

    Ok(true)
}

fn build_upgrade_policy(
    package_name: Option<&str>,
    target_version: Option<&str>,
    min_version: Option<&str>,
) -> Option<webmux_shared::AgentUpgradePolicy> {
    let pkg = package_name?;
    if pkg.is_empty() {
        return None;
    }
    Some(webmux_shared::AgentUpgradePolicy {
        package_name: pkg.to_string(),
        target_version: target_version.map(|s| s.to_string()),
        minimum_version: min_version.map(|s| s.to_string()),
    })
}

fn is_below_minimum_version(version: Option<&str>, minimum: &str) -> bool {
    let Some(ver) = version else {
        return true;
    };
    match compare_semver(ver, minimum) {
        Some(ord) => ord < 0,
        None => true,
    }
}

/// Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
fn compare_semver(a: &str, b: &str) -> Option<i32> {
    let parse = |s: &str| -> Option<(u32, u32, u32)> {
        let parts: Vec<&str> = s.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        ))
    };

    let (a_major, a_minor, a_patch) = parse(a)?;
    let (b_major, b_minor, b_patch) = parse(b)?;

    if a_major != b_major {
        return Some(a_major as i32 - b_major as i32);
    }
    if a_minor != b_minor {
        return Some(a_minor as i32 - b_minor as i32);
    }
    Some(a_patch as i32 - b_patch as i32)
}

// ---------------------------------------------------------------------------
// Thread (Run) WebSocket endpoint — /ws/thread
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ThreadWsQuery {
    pub token: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
}

pub async fn ws_thread_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<ThreadWsQuery>,
    State(state): State<AppState>,
) -> Response {
    // Verify JWT
    let payload = match verify_jwt(&params.token, &state.config.jwt_secret) {
        Ok(p) => p,
        Err(_) => {
            return axum::http::StatusCode::UNAUTHORIZED.into_response();
        }
    };

    let user_id = payload.sub;
    let thread_id = params.thread_id;

    // Verify run exists and belongs to user
    let db = state.db.clone();
    let tid = thread_id.clone();
    let uid = user_id.clone();
    let run_row = {
        let conn = match db.get() {
            Ok(c) => c,
            Err(_) => return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        match crate::db::runs::find_run_by_id(&conn, &tid) {
            Ok(Some(r)) if r.user_id == uid => Some(r),
            _ => None,
        }
    };

    let Some(run_row) = run_row else {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    };

    ws.on_upgrade(move |socket| handle_thread_ws(socket, thread_id, run_row, state))
}

async fn handle_thread_ws(
    socket: WebSocket,
    run_id: String,
    run_row: crate::db::types::RunRow,
    state: AppState,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register this client
    let client_id = {
        let mut hub = state.hub.write().await;
        let cid = hub.next_client_id();
        hub.add_run_client(&run_id, cid, tx.clone());
        cid
    };

    // Send current run state immediately
    let initial_event = webmux_shared::RunEvent::RunStatus {
        run: run_row_to_run(&run_row),
    };
    let _ = tx.send(serde_json::to_string(&initial_event).unwrap_or_default());

    // Spawn writer task
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Read loop — just wait for close
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    // Cleanup
    {
        let mut hub = state.hub.write().await;
        hub.remove_run_client(&run_id, client_id);
    }

    drop(tx);
    let _ = write_task.await;
}

// ---------------------------------------------------------------------------
// Project WebSocket endpoint — /ws/project
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ProjectWsQuery {
    pub token: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
}

pub async fn ws_project_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<ProjectWsQuery>,
    State(state): State<AppState>,
) -> Response {
    // Verify JWT
    let payload = match verify_jwt(&params.token, &state.config.jwt_secret) {
        Ok(p) => p,
        Err(_) => {
            return axum::http::StatusCode::UNAUTHORIZED.into_response();
        }
    };

    let user_id = payload.sub;
    let project_id = params.project_id;

    // Verify project exists and belongs to user
    let db = state.db.clone();
    let pid = project_id.clone();
    let uid = user_id.clone();
    let project_valid = {
        let conn = match db.get() {
            Ok(c) => c,
            Err(_) => return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        match crate::db::projects::find_project_by_id(&conn, &pid) {
            Ok(Some(p)) if p.user_id == uid => true,
            _ => false,
        }
    };

    if !project_valid {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    }

    ws.on_upgrade(move |socket| handle_project_ws(socket, project_id, state))
}

async fn handle_project_ws(socket: WebSocket, project_id: String, state: AppState) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register this client
    let client_id = {
        let mut hub = state.hub.write().await;
        let cid = hub.next_client_id();
        hub.add_project_client(&project_id, cid, tx.clone());
        cid
    };

    // Spawn writer task
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Read loop — just wait for close
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    // Cleanup
    {
        let mut hub = state.hub.write().await;
        hub.remove_project_client(&project_id, client_id);
    }

    drop(tx);
    let _ = write_task.await;
}
