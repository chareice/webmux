use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use webmux_shared::{
    ContinueRunRequest, Run, RunDetailResponse, RunImageAttachment, RunImageAttachmentUpload,
    RunListResponse, RunTool, ServerToAgentMessage, StartRunRequest,
    UpdateQueuedTurnRequest,
};

use crate::auth::AuthUser;
use crate::db::runs::{
    create_queued_run_turn, create_run_turn, create_run_with_initial_turn,
    delete_run, delete_run_turn, find_active_run_turn_by_run_id, find_run_by_id,
    find_run_turn_by_id, find_run_turn_details, find_runs_by_user_id, mark_run_read,
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

fn uploads_to_metadata(uploads: &[RunImageAttachmentUpload]) -> Vec<RunImageAttachment> {
    uploads.iter().map(|u| RunImageAttachment {
        id: u.id.clone(), name: u.name.clone(), mime_type: u.mime_type.clone(), size_bytes: u.size_bytes,
    }).collect()
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/runs", get(list_runs))
        .route("/runs/{id}", get(get_run_detail))
        .route("/runs/{id}", delete(delete_run_handler))
        .route("/runs", post(start_run))
        .route("/runs/{id}/turns", post(continue_run))
        .route("/runs/{id}/interrupt", post(interrupt_run))
        .route("/runs/{id}/kill", post(kill_run))
        .route("/runs/{id}/read", post(mark_read))
        .route("/runs/{id}/turns/{turn_id}", put(update_queued_turn))
        .route("/runs/{id}/turns/{turn_id}", delete(delete_queued_turn))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/runs
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

/// GET /api/runs/:id
async fn get_run_detail(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || -> Result<RunDetailResponse, &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let row = find_run_by_id(&conn, &id).map_err(|_| "internal")?;
        match row {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(r) => {
                let turns = find_run_turn_details(&conn, &id).map_err(|_| "internal")?;
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

/// POST /api/runs — Start a new run (finds user's first online agent)
async fn start_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<StartRunRequest>,
) -> impl IntoResponse {
    let attachments = match normalize_attachments(body.attachments.as_deref()) {
        Ok(a) => a,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response(),
    };

    let prompt = body.prompt.trim().to_string();
    let repo_path = body.repo_path.trim().to_string();
    if (prompt.is_empty() && attachments.is_empty()) || repo_path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing required fields: tool, repoPath, and prompt or attachments" }))).into_response();
    }

    // Find user's agents
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let agents_result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        crate::db::agents::find_agents_by_user_id(&conn, &user_id).map_err(|e| e.to_string())
    }).await;

    let agents = match agents_result {
        Ok(Ok(a)) => a,
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let hub = state.hub.read().await;
    let online_agent = agents.iter().find(|a| hub.is_agent_online(&a.id));
    let agent = match online_agent {
        Some(a) => a.clone(),
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "No online agent available" }))).into_response(),
    };

    let run_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    let tool = body.tool.clone();
    let options = body.options.clone();
    let tool_str = serde_json::to_string(&tool).unwrap_or("\"claude\"".into()).trim_matches('"').to_string();
    let attachment_meta = uploads_to_metadata(&attachments);

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
            tool: &tool_str, repo_path: &rp, prompt: &p, branch: None,
            attachments: Some(&attachment_meta),
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

/// POST /api/runs/:id/turns
async fn continue_run(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
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

    let attachment_meta = uploads_to_metadata(&attachments);
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
                id: &tid, run_id: &id2, prompt: &p, attachments: Some(&attachment_meta),
            }).map_err(|_| "internal")?;
            let run = find_run_by_id(&conn, &id2).map_err(|_| "internal")?.unwrap();
            let turns = find_run_turn_details(&conn, &id2).map_err(|_| "internal")?;
            return Ok(("queued", agent_hub::run_row_to_run(&run), turns, run_row.agent_id, run_row.tool_thread_id, run_row.tool, run_row.repo_path));
        }

        // Create active turn
        create_run_turn(&conn, CreateRunTurnOpts {
            id: &tid, run_id: &id2, prompt: &p, attachments: Some(&attachment_meta),
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

/// POST /api/runs/:id/interrupt
async fn interrupt_run(
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

/// POST /api/runs/:id/kill
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

/// POST /api/runs/:id/read
async fn mark_read(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|_| "internal")?;
        let r = find_run_by_id(&conn, &id).map_err(|_| "internal")?;
        match r {
            None => Err("not_found"),
            Some(r) if r.user_id != user_id => Err("forbidden"),
            Some(_) => { mark_run_read(&conn, &id).map_err(|_| "internal")?; Ok(()) }
        }
    }).await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err("not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run not found" }))).into_response(),
        Ok(Err("forbidden")) => (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Not your run" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// DELETE /api/runs/:id
async fn delete_run_handler(
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

/// PUT /api/runs/:id/turns/:turnId
async fn update_queued_turn(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((id, turn_id)): Path<(String, String)>,
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

/// DELETE /api/runs/:id/turns/:turnId
async fn delete_queued_turn(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((id, turn_id)): Path<(String, String)>,
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
