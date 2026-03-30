use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use webmux_shared::{
    ContinueRunRequest, Run, RunDetailResponse, RunImageAttachmentUpload,
    RunListResponse, RunTool, ServerToAgentMessage, StartRunRequest,
    UpdateQueuedTurnRequest,
};

use crate::auth::AuthUser;
use crate::db::agents::find_agent_by_id;
use crate::db::runs::{
    create_queued_run_turn, create_run_turn, create_run_with_initial_turn,
    delete_queued_turns_by_run_id, delete_run, delete_run_turn,
    find_active_run_turn_by_run_id, find_run_by_id, find_run_turn_by_id,
    find_run_turn_details, find_runs_by_agent_id, find_runs_by_user_id, mark_run_read,
    update_queued_turn_prompt, CreateQueuedRunTurnOpts, CreateRunTurnOpts,
    CreateRunWithInitialTurnOpts,
};
use crate::db::types::RunRow;
use crate::state::AppState;
use crate::ws::agent_hub;

// ---------------------------------------------------------------------------
// Helper: convert RunRow to shared Run type (pub for use by other route modules)
// ---------------------------------------------------------------------------

pub fn run_row_to_run_public(row: &RunRow) -> Run {
    agent_hub::run_row_to_run(row)
}

const MAX_IMAGE_ATTACHMENTS: usize = 4;
const MAX_IMAGE_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;

fn normalize_attachments(
    attachments: Option<&[RunImageAttachmentUpload]>,
) -> Result<Vec<RunImageAttachmentUpload>, String> {
    let Some(atts) = attachments else {
        return Ok(Vec::new());
    };
    if atts.len() > MAX_IMAGE_ATTACHMENTS {
        return Err(format!("At most {} images can be attached", MAX_IMAGE_ATTACHMENTS));
    }
    let mut result = Vec::with_capacity(atts.len());
    for (i, entry) in atts.iter().enumerate() {
        if !entry.mime_type.starts_with("image/") {
            return Err("Only image attachments are supported".to_string());
        }
        if entry.base64.is_empty() {
            return Err("Image attachment is missing base64 data".to_string());
        }
        if entry.size_bytes as usize > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err("Each image must be 5MB or smaller".to_string());
        }
        result.push(RunImageAttachmentUpload {
            id: if entry.id.is_empty() { uuid::Uuid::new_v4().to_string() } else { entry.id.clone() },
            name: if entry.name.is_empty() { format!("image-{}", i + 1) } else { entry.name.clone() },
            mime_type: entry.mime_type.clone(),
            size_bytes: entry.size_bytes,
            base64: entry.base64.clone(),
        });
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // GET /api/threads — list all threads for current user
        .route("/threads", get(list_runs))
        // GET /api/agents/:id/threads — list threads for a specific agent
        .route("/agents/{id}/threads", get(list_agent_threads))
        // GET /api/agents/:id/threads/:threadId — thread detail
        .route("/agents/{id}/threads/{thread_id}", get(get_run_detail))
        // POST /api/agents/:id/threads — start a new thread
        .route("/agents/{id}/threads", post(start_run))
        // POST /api/agents/:id/threads/:threadId/turns — continue a thread
        .route("/agents/{id}/threads/{thread_id}/turns", post(continue_run))
        // POST /api/agents/:id/threads/:threadId/interrupt — interrupt a thread
        .route("/agents/{id}/threads/{thread_id}/interrupt", post(interrupt_run))
        // POST /api/agents/:id/threads/:threadId/read — mark thread as read
        .route("/agents/{id}/threads/{thread_id}/read", post(mark_read))
        // DELETE /api/agents/:id/threads/:threadId — delete a thread
        .route("/agents/{id}/threads/{thread_id}", delete(delete_run_handler))
        // PATCH /api/agents/:id/threads/:threadId/turns/:turnId — update queued turn
        .route("/agents/{id}/threads/{thread_id}/turns/{turn_id}", patch(update_queued_turn))
        // DELETE /api/agents/:id/threads/:threadId/turns/:turnId — delete queued turn
        .route("/agents/{id}/threads/{thread_id}/turns/{turn_id}", delete(delete_queued_turn))
        // POST /api/agents/:id/threads/:threadId/discard-queue — discard all queued turns
        .route("/agents/{id}/threads/{thread_id}/discard-queue", post(discard_queue))
        // POST /api/agents/:id/threads/:threadId/resume-queue — resume next queued turn
        .route("/agents/{id}/threads/{thread_id}/resume-queue", post(resume_queue))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/threads — list all threads for current user
async fn list_runs(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let rows = find_runs_by_user_id(&conn, &user_id).map_err(|e| e.to_string())?;
        let runs: Vec<Run> = rows.iter().map(agent_hub::run_row_to_run).collect();
        Ok::<_, String>(RunListResponse { runs })
    }).await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// GET /api/agents/:id/threads — list threads for a specific agent
async fn list_agent_threads(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(agent_id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let agent = find_agent_by_id(&conn, &agent_id).map_err(|e| e.to_string())?;
        match agent {
            None => return Err("Agent not found".to_string()),
            Some(a) if a.user_id != user_id => return Err("Not your agent".to_string()),
            _ => {}
        }
        let rows = find_runs_by_agent_id(&conn, &agent_id).map_err(|e| e.to_string())?;
        let runs: Vec<Run> = rows.iter().map(agent_hub::run_row_to_run).collect();
        Ok::<_, String>(RunListResponse { runs })
    }).await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// GET /api/agents/:id/threads/:threadId — thread detail
async fn get_run_detail(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, thread_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || -> Result<RunDetailResponse, &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let row = find_run_by_id(&conn, &thread_id).map_err(|_| "internal")?;
        match row {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(r) => {
                let turns = find_run_turn_details(&conn, &thread_id).map_err(|_| "internal")?;
                Ok(RunDetailResponse { run: agent_hub::run_row_to_run(&r), turns })
            }
        }
    }).await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/:id/threads — Start a new thread
async fn start_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(agent_id): Path<String>,
    Json(body): Json<StartRunRequest>,
) -> impl IntoResponse {
    let attachments = match normalize_attachments(body.attachments.as_deref()) {
        Ok(a) => a,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response(),
    };

    let prompt = body.prompt.trim().to_string();
    let repo_path = body.repo_path.trim().to_string();
    let existing_session_id = body
        .existing_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if (prompt.is_empty() && attachments.is_empty()) || repo_path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing required fields: tool, repoPath, and prompt or attachments" }))).into_response();
    }
    if existing_session_id.is_some() && body.options.as_ref().and_then(|opts| opts.clear_session).unwrap_or(false) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Cannot import an existing session while clearSession is enabled" }))).into_response();
    }

    // Verify agent belongs to user
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let aid = agent_id.clone();
    let agent_result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        find_agent_by_id(&conn, &aid).map_err(|e| e.to_string())
    }).await;

    let agent = match agent_result {
        Ok(Ok(Some(a))) if a.user_id == user_id => a,
        Ok(Ok(Some(_))) => return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your agent" }))).into_response(),
        Ok(Ok(None)) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Agent not found" }))).into_response(),
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&agent.id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    let tool = body.tool.clone();
    let options = body.options.clone();
    let tool_str = serde_json::to_string(&tool).unwrap_or("\"claude\"".into()).trim_matches('"').to_string();
    let db_attachments = attachments.clone();
    let imported_session_id = existing_session_id.clone();

    let db = state.db.clone();
    let rid = run_id.clone();
    let tid = turn_id.clone();
    let aid = agent.id.clone();
    let uid = auth_user.user_id.clone();
    let p = prompt.clone();
    let rp = repo_path.clone();

    let db_result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let (run_row, _) = create_run_with_initial_turn(&conn, CreateRunWithInitialTurnOpts {
            run_id: &rid, turn_id: &tid, agent_id: &aid, user_id: &uid,
            tool: &tool_str, tool_thread_id: imported_session_id.as_deref(), repo_path: &rp, prompt: &p, branch: None,
            attachments: Some(&db_attachments),
        }).map_err(|e| e.to_string())?;
        let turns = find_run_turn_details(&conn, &rid).map_err(|e| e.to_string())?;
        Ok::<_, String>((run_row, turns))
    }).await;

    let (run_row, turns) = match db_result {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let msg = ServerToAgentMessage::RunTurnStart {
        run_id: run_id.clone(), turn_id: turn_id.clone(), tool, repo_path,
        prompt, tool_thread_id: run_row.tool_thread_id.clone(),
        attachments: if attachments.is_empty() { None } else { Some(attachments) },
        options,
    };

    if !hub.send_to_agent(&agent.id, &msg) {
        drop(hub);
        let db = state.db.clone();
        let rid = run_id.clone();
        let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run(&c, &rid); } }).await;
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable before the thread could start" }))).into_response();
    }
    drop(hub);

    let resp = RunDetailResponse { run: agent_hub::run_row_to_run(&run_row), turns };
    (StatusCode::CREATED, Json(serde_json::to_value(resp).unwrap())).into_response()
}

/// POST /api/agents/:id/threads/:threadId/turns
async fn continue_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id)): Path<(String, String)>,
    Json(body): Json<ContinueRunRequest>,
) -> impl IntoResponse {
    let attachments = match normalize_attachments(body.attachments.as_deref()) {
        Ok(a) => a,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response(),
    };

    let trimmed_prompt = body.prompt.trim().to_string();
    if trimmed_prompt.is_empty() && attachments.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing prompt or attachments" }))).into_response();
    }

    let db_attachments = attachments.clone();
    let options = body.options.clone();
    let turn_id = uuid::Uuid::new_v4().to_string();

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();
    let tid = turn_id.clone();
    let p = trimmed_prompt.clone();

    // DB operations
    let result = tokio::task::spawn_blocking(move || -> Result<_, &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let run_row = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        let run_row = match run_row {
            None => return Err("run_not_found"),
            Some(r) if r.user_id != user_id => return Err("forbidden"),
            Some(r) => r,
        };

        let active = find_active_run_turn_by_run_id(&conn, &id2).map_err(|_| "internal")?;
        if active.is_some() {
            // Queue the turn
            create_queued_run_turn(&conn, CreateQueuedRunTurnOpts {
                id: &tid, run_id: &id2, prompt: &p, attachments: Some(&db_attachments),
            }).map_err(|_| "internal")?;
            let run = find_run_by_id(&conn, &id2).map_err(|_| "internal")?.unwrap();
            let turns = find_run_turn_details(&conn, &id2).map_err(|_| "internal")?;
            return Ok(("queued", agent_hub::run_row_to_run(&run), turns, run_row.agent_id, run_row.tool_thread_id, run_row.tool, run_row.repo_path));
        }

        // Create active turn
        create_run_turn(&conn, CreateRunTurnOpts {
            id: &tid, run_id: &id2, prompt: &p, attachments: Some(&db_attachments),
        }).map_err(|_| "internal")?;
        let run = find_run_by_id(&conn, &id2).map_err(|_| "internal")?.unwrap();
        let turns = find_run_turn_details(&conn, &id2).map_err(|_| "internal")?;
        Ok(("active", agent_hub::run_row_to_run(&run), turns, run_row.agent_id, run_row.tool_thread_id, run_row.tool, run_row.repo_path))
    }).await;

    match result {
        Ok(Ok((mode, run, turns, agent_id, tool_thread_id, tool_str, repo_path))) => {
            if mode == "queued" {
                let hub = state.hub.read().await;
                let conn = state.db.get().ok();
                if let Some(conn) = conn.as_ref() {
                    agent_hub::broadcast_run_snapshot(&hub, conn, &id, Some(&turn_id));
                }
                return (StatusCode::OK, Json(serde_json::to_value(RunDetailResponse { run, turns }).unwrap())).into_response();
            }

            // Active: send to agent
            let hub = state.hub.read().await;
            if !hub.is_agent_online(&agent_id) {
                drop(hub);
                let db = state.db.clone();
                let tid = turn_id.clone();
                let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run_turn(&c, &tid); } }).await;
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
            }

            let tool: RunTool = serde_json::from_str(&format!("\"{}\"", tool_str)).unwrap_or(RunTool::Claude);
            let msg = ServerToAgentMessage::RunTurnStart {
                run_id: id.clone(), turn_id: turn_id.clone(), tool, repo_path,
                prompt: trimmed_prompt, tool_thread_id,
                attachments: if attachments.is_empty() { None } else { Some(attachments) },
                options,
            };

            if !hub.send_to_agent(&agent_id, &msg) {
                drop(hub);
                let db = state.db.clone();
                let tid = turn_id.clone();
                let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run_turn(&c, &tid); } }).await;
                return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable" }))).into_response();
            }

            if let Ok(conn) = state.db.get() {
                agent_hub::broadcast_run_snapshot(&hub, &conn, &id, None);
            }
            drop(hub);
            (StatusCode::OK, Json(serde_json::to_value(RunDetailResponse { run, turns }).unwrap())).into_response()
        }
        Ok(Err("run_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/:id/threads/:threadId/interrupt
async fn interrupt_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(r) => {
                let active = find_active_run_turn_by_run_id(&conn, &id2).map_err(|_| "internal")?;
                match active {
                    None => Err("not_active"),
                    Some(t) => Ok((r.agent_id, t.id)),
                }
            }
        }
    }).await;

    match result {
        Ok(Ok((agent_id, turn_id))) => {
            let hub = state.hub.read().await;
            if !hub.is_agent_online(&agent_id) {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
            }
            let msg = ServerToAgentMessage::RunTurnInterrupt { run_id: id.clone(), turn_id };
            if !hub.send_to_agent(&agent_id, &msg) {
                return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable" }))).into_response();
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err("not_active")) => (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Thread is not active" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// Kill run — not exposed as a public route, kept for internal use
#[allow(dead_code)]
async fn kill_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(r) => {
                let active = find_active_run_turn_by_run_id(&conn, &id2).map_err(|_| "internal")?;
                Ok((r.agent_id, active.map(|t| t.id)))
            }
        }
    }).await;

    match result {
        Ok(Ok((agent_id, active_turn_id))) => {
            if let Some(turn_id) = active_turn_id {
                let hub = state.hub.read().await;
                if hub.is_agent_online(&agent_id) {
                    let msg = ServerToAgentMessage::RunTurnKill { run_id: id.clone(), turn_id };
                    let _ = hub.send_to_agent(&agent_id, &msg);
                }
            }
            let db = state.db.clone();
            let rid = id.clone();
            let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run(&c, &rid); } }).await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/:id/threads/:threadId/read
async fn mark_read(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(_) => { mark_run_read(&conn, &id).map_err(|_| "internal")?; Ok(id) }
        }
    }).await;

    match result {
        Ok(Ok(run_id)) => {
            // Broadcast updated run to all connected clients so unread state syncs in real-time
            let hub = state.hub.read().await;
            if let Ok(conn) = state.db.get() {
                agent_hub::broadcast_run_snapshot(&hub, &conn, &run_id, None);
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// DELETE /api/agents/:id/threads/:threadId
async fn delete_run_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(r) => {
                let active = find_active_run_turn_by_run_id(&conn, &id2).map_err(|_| "internal")?;
                Ok((r.agent_id, active.map(|t| t.id)))
            }
        }
    }).await;

    match result {
        Ok(Ok((agent_id, active_turn_id))) => {
            if let Some(turn_id) = active_turn_id {
                let hub = state.hub.read().await;
                if hub.is_agent_online(&agent_id) {
                    let msg = ServerToAgentMessage::RunTurnKill { run_id: id.clone(), turn_id };
                    let _ = hub.send_to_agent(&agent_id, &msg);
                }
            }
            let db = state.db.clone();
            let rid = id.clone();
            let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run(&c, &rid); } }).await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// PATCH /api/agents/:id/threads/:threadId/turns/:turnId
async fn update_queued_turn(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id, turn_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateQueuedTurnRequest>,
) -> impl IntoResponse {
    let prompt = body.prompt.trim().to_string();
    if prompt.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing prompt" }))).into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let id2 = id.clone();
    let tid = turn_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        match &r {
            None => return Err("not_found"),
            Some(r) if r.user_id != user_id => return Err("forbidden"),
            _ => {}
        }
        let turn = find_run_turn_by_id(&conn, &tid).map_err(|_| "internal")?;
        match &turn {
            None => return Err("turn_not_found"),
            Some(t) if t.run_id != id2 => return Err("turn_not_found"),
            _ => {}
        }
        let updated = update_queued_turn_prompt(&conn, &tid, &prompt).map_err(|_| "internal")?;
        if updated.is_none() { return Err("not_queued"); }
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => {
            let hub = state.hub.read().await;
            if let Ok(conn) = state.db.get() {
                agent_hub::broadcast_run_snapshot(&hub, &conn, &id, Some(&turn_id));
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found" | "forbidden")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("turn_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Turn not found" }))).into_response(),
        Ok(Err("not_queued")) => (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Turn is not queued" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// DELETE /api/agents/:id/threads/:threadId/turns/:turnId
async fn delete_queued_turn(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, id, turn_id)): Path<(String, String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id2).map_err(|_| "internal")?;
        match &r {
            None => return Err("not_found"),
            Some(r) if r.user_id != user_id => return Err("forbidden"),
            _ => {}
        }
        let turn = find_run_turn_by_id(&conn, &turn_id).map_err(|_| "internal")?;
        match &turn {
            None => return Err("not_queued"),
            Some(t) if t.run_id != id2 || t.status != "queued" => return Err("not_queued"),
            _ => {}
        }
        delete_run_turn(&conn, &turn_id).map_err(|_| "internal")?;
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => {
            let hub = state.hub.read().await;
            if let Ok(conn) = state.db.get() {
                agent_hub::broadcast_run_snapshot(&hub, &conn, &id, None);
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err("not_found" | "forbidden")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("not_queued")) => (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Turn is not queued" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/:id/threads/:threadId/discard-queue — discard all queued turns
async fn discard_queue(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_agent_id, thread_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let tid = thread_id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<i64, &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &tid).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(_) => {
                let deleted = delete_queued_turns_by_run_id(&conn, &tid).map_err(|_| "internal")?;
                Ok(deleted as i64)
            }
        }
    }).await;

    match result {
        Ok(Ok(deleted)) => {
            let hub = state.hub.read().await;
            if let Ok(conn) = state.db.get() {
                agent_hub::broadcast_run_snapshot(&hub, &conn, &thread_id, None);
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true, "deleted": deleted }))).into_response()
        }
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/:id/threads/:threadId/resume-queue — dispatch next queued turn
async fn resume_queue(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((agent_id, thread_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let tid = thread_id.clone();
    let aid = agent_id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let agent = find_agent_by_id(&conn, &aid).map_err(|_| "internal")?;
        match agent {
            None => return Err("agent_not_found"),
            Some(a) if a.user_id != user_id => return Err("agent_not_found"),
            _ => {}
        }
        let active = find_active_run_turn_by_run_id(&conn, &tid).map_err(|_| "internal")?;
        if active.is_some() {
            return Err("still_active");
        }
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => {
            let hub = state.hub.read().await;
            if !hub.is_agent_online(&agent_id) {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
            }
            if let Ok(conn) = state.db.get() {
                if !agent_hub::dispatch_next_queued_turn_pub(&hub, &conn, &agent_id, &thread_id) {
                    return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "No queued turns" }))).into_response();
                }
                let run = find_run_by_id(&conn, &thread_id).ok().flatten();
                let turns = find_run_turn_details(&conn, &thread_id).unwrap_or_default();
                if let Some(r) = run {
                    let resp = RunDetailResponse { run: agent_hub::run_row_to_run(&r), turns };
                    return (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response();
                }
            }
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal error" }))).into_response()
        }
        Ok(Err("agent_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Agent not found" }))).into_response(),
        Ok(Err("still_active")) => (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Thread is still active" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}
