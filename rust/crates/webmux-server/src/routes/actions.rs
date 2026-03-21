use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use webmux_shared::{
    CreateProjectActionRequest, GenerateProjectActionRequest, ProjectActionListResponse,
    RunImageAttachmentUpload, RunTool, ServerToAgentMessage, UpdateProjectActionRequest,
};

use crate::auth::AuthUser;
use crate::db::projects::{
    create_project_action, delete_project_action, find_project_action_by_id,
    find_project_actions_by_project_id, find_project_by_id, update_project_action,
    CreateProjectActionOpts, UpdateProjectActionOpts,
};
use crate::db::runs::{create_run_with_initial_turn, delete_run, CreateRunWithInitialTurnOpts};
use crate::routes::projects::action_row_to_action;
use crate::state::AppState;
use crate::ws::agent_hub;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/projects/{project_id}/actions", get(list_actions))
        .route("/projects/{project_id}/actions", post(create_action))
        .route("/projects/{project_id}/actions/generate", post(generate_action))
        .route("/projects/{project_id}/actions/{action_id}", patch(update_action))
        .route("/projects/{project_id}/actions/{action_id}", delete(delete_action))
        .route("/projects/{project_id}/actions/{action_id}/run", post(run_action))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/projects/:projectId/actions
async fn list_actions(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project = find_project_by_id(&conn, &project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }
        let rows = find_project_actions_by_project_id(&conn, &project_id).map_err(|e| e.to_string())?;
        Ok::<_, String>(ProjectActionListResponse { actions: rows.iter().map(action_row_to_action).collect() })
    }).await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(ref e)) if e == "not_found" => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/projects/:projectId/actions
async fn create_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CreateProjectActionRequest>,
) -> impl IntoResponse {
    let name = body.name.trim().to_string();
    let prompt = body.prompt.trim().to_string();
    if name.is_empty() || prompt.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing required fields: name and prompt" }))).into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let description = body.description.as_deref().map(|s| s.trim().to_string());
    let tool = body.tool.as_ref().map(|t| serde_json::to_string(t).unwrap_or("\"claude\"".into()).trim_matches('"').to_string());

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project = find_project_by_id(&conn, &project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }
        let action = create_project_action(&conn, CreateProjectActionOpts {
            project_id: &project_id, name: &name, description: description.as_deref(),
            prompt: &prompt, tool: tool.as_deref(), sort_order: None,
        }).map_err(|e| e.to_string())?;
        Ok(action_row_to_action(&action))
    }).await;

    match result {
        Ok(Ok(action)) => (StatusCode::CREATED, Json(serde_json::json!({ "action": action }))).into_response(),
        Ok(Err(ref e)) if e == "not_found" => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// PATCH /api/projects/:projectId/actions/:actionId
async fn update_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((project_id, action_id)): Path<(String, String)>,
    Json(body): Json<UpdateProjectActionRequest>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;
    let name = body.name.as_deref().map(|s| s.trim().to_string());
    let description = body.description.as_deref().map(|s| s.trim().to_string());
    let prompt = body.prompt.as_deref().map(|s| s.trim().to_string());
    let tool = body.tool.as_ref().map(|t| serde_json::to_string(t).unwrap_or("\"claude\"".into()).trim_matches('"').to_string());
    let sort_order = body.sort_order;

    let result = tokio::task::spawn_blocking(move || -> Result<(), &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let project = find_project_by_id(&conn, &project_id).map_err(|_| "internal")?;
        match project { None => return Err("project_not_found"), Some(p) if p.user_id != user_id => return Err("project_not_found"), _ => {} }
        let action = find_project_action_by_id(&conn, &action_id).map_err(|_| "internal")?;
        match action { None => return Err("action_not_found"), Some(a) if a.project_id != project_id => return Err("action_not_found"), _ => {} }
        update_project_action(&conn, &action_id, UpdateProjectActionOpts {
            name: name.as_deref(), description: description.as_deref(), prompt: prompt.as_deref(),
            tool: tool.as_deref(), sort_order,
        }).map_err(|_| "internal")?;
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err("project_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err("action_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Action not found" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// DELETE /api/projects/:projectId/actions/:actionId
async fn delete_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((project_id, action_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id;

    let result = tokio::task::spawn_blocking(move || -> Result<(), &'static str> {
        let conn = db.get().map_err(|_| "internal")?;
        let project = find_project_by_id(&conn, &project_id).map_err(|_| "internal")?;
        match project { None => return Err("project_not_found"), Some(p) if p.user_id != user_id => return Err("project_not_found"), _ => {} }
        let action = find_project_action_by_id(&conn, &action_id).map_err(|_| "internal")?;
        match action { None => return Err("action_not_found"), Some(a) if a.project_id != project_id => return Err("action_not_found"), _ => {} }
        delete_project_action(&conn, &action_id).map_err(|_| "internal")?;
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err("project_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err("action_not_found")) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Action not found" }))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/projects/:projectId/actions/generate
async fn generate_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<GenerateProjectActionRequest>,
) -> impl IntoResponse {
    let description = body.description.trim().to_string();
    if description.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing required field: description" }))).into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let project_result = tokio::task::spawn_blocking({
        let db = db.clone();
        let user_id = user_id.clone();
        let pid = project_id.clone();
        move || {
            let conn = db.get().map_err(|e| e.to_string())?;
            let project = find_project_by_id(&conn, &pid).map_err(|e| e.to_string())?;
            match project {
                None => Err("not_found".to_string()),
                Some(p) if p.user_id != user_id => Err("not_found".to_string()),
                Some(p) => Ok(p),
            }
        }
    }).await;

    let project = match project_result {
        Ok(Ok(p)) => p,
        Ok(Err(ref e)) if e == "not_found" => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let agent_id = project.agent_id.clone();
    let hub = state.hub.read().await;
    if !hub.is_agent_online(&agent_id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    let generate_prompt = format!(
        "Analyze the project at the given repo path and create an action definition based on the user's description.\n\n\
         User wants: {}\n\n\
         You must output a JSON object with exactly these fields:\n\
         {{ \"name\": \"...\", \"description\": \"...\", \"prompt\": \"...\" }}\n\n\
         The \"prompt\" field should contain the complete instructions that will be sent to Claude Code when this action is executed later.\n\
         Output ONLY the JSON, no markdown fences, no explanation.",
        description
    );

    let run_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    let tool_str = if project.default_tool.is_empty() { "claude".to_string() } else { project.default_tool.clone() };
    let tool: RunTool = serde_json::from_str(&format!("\"{}\"", tool_str)).unwrap_or(RunTool::Claude);

    let db2 = state.db.clone();
    let rid = run_id.clone();
    let tid = turn_id.clone();
    let aid = agent_id.clone();
    let uid = user_id.clone();
    let rp = project.repo_path.clone();
    let p = generate_prompt.clone();
    let ts = tool_str.clone();

    let db_result = tokio::task::spawn_blocking(move || {
        let conn = db2.get().map_err(|e| e.to_string())?;
        let empty: Vec<RunImageAttachmentUpload> = Vec::new();
        let (run_row, _) = create_run_with_initial_turn(&conn, CreateRunWithInitialTurnOpts {
            run_id: &rid, turn_id: &tid, agent_id: &aid, user_id: &uid,
            tool: &ts, repo_path: &rp, prompt: &p, branch: None, attachments: Some(&empty),
        }).map_err(|e| e.to_string())?;
        Ok::<_, String>(run_row)
    }).await;

    let run_row = match db_result {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let msg = ServerToAgentMessage::RunTurnStart {
        run_id: run_id.clone(), turn_id: turn_id.clone(), tool,
        repo_path: project.repo_path.clone(), prompt: generate_prompt,
        tool_thread_id: run_row.tool_thread_id, attachments: Some(Vec::new()), options: None,
    };

    if !hub.send_to_agent(&agent_id, &msg) {
        drop(hub);
        let db = state.db.clone();
        let rid = run_id.clone();
        let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run(&c, &rid); } }).await;
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable before the generation could start" }))).into_response();
    }

    if let Ok(conn) = state.db.get() {
        agent_hub::broadcast_run_snapshot(&hub, &conn, &run_id, Some(&turn_id));
    }
    drop(hub);

    (StatusCode::OK, Json(serde_json::json!({ "runId": run_id }))).into_response()
}

/// POST /api/projects/:projectId/actions/:actionId/run — execute an action
async fn run_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((project_id, action_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let project_result = tokio::task::spawn_blocking({
        let db = db.clone();
        let pid = project_id.clone();
        let uid = user_id.clone();
        let aid = action_id.clone();
        move || {
            let conn = db.get().map_err(|e| e.to_string())?;
            let project = find_project_by_id(&conn, &pid).map_err(|e| e.to_string())?;
            match project {
                None => return Err("project_not_found".to_string()),
                Some(p) if p.user_id != uid => return Err("project_not_found".to_string()),
                _ => {}
            }
            let action = find_project_action_by_id(&conn, &aid).map_err(|e| e.to_string())?;
            match action {
                None => return Err("action_not_found".to_string()),
                Some(a) if a.project_id != pid => return Err("action_not_found".to_string()),
                _ => {}
            }
            Ok((project.unwrap(), action.unwrap()))
        }
    }).await;

    let (project, action) = match project_result {
        Ok(Ok((p, a))) => (p, a),
        Ok(Err(ref e)) if e == "project_not_found" => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Project not found" }))).into_response(),
        Ok(Err(ref e)) if e == "action_not_found" => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Action not found" }))).into_response(),
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let agent_id = project.agent_id.clone();
    let hub = state.hub.read().await;
    if !hub.is_agent_online(&agent_id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    let tool_str = action.tool.clone();
    let tool: RunTool = serde_json::from_str(&format!("\"{}\"", tool_str)).unwrap_or(RunTool::Claude);

    let db2 = state.db.clone();
    let rid = run_id.clone();
    let tid = turn_id.clone();
    let aid = agent_id.clone();
    let uid = user_id.clone();
    let rp = project.repo_path.clone();
    let p = action.prompt.clone();
    let ts = tool_str.clone();

    let db_result = tokio::task::spawn_blocking(move || {
        let conn = db2.get().map_err(|e| e.to_string())?;
        let empty: Vec<RunImageAttachmentUpload> = Vec::new();
        let (run_row, _) = create_run_with_initial_turn(&conn, CreateRunWithInitialTurnOpts {
            run_id: &rid, turn_id: &tid, agent_id: &aid, user_id: &uid,
            tool: &ts, repo_path: &rp, prompt: &p, branch: None, attachments: Some(&empty),
        }).map_err(|e| e.to_string())?;
        Ok::<_, String>(run_row)
    }).await;

    let run_row = match db_result {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let msg = ServerToAgentMessage::RunTurnStart {
        run_id: run_id.clone(), turn_id: turn_id.clone(), tool,
        repo_path: project.repo_path.clone(), prompt: action.prompt.clone(),
        tool_thread_id: run_row.tool_thread_id, attachments: Some(Vec::new()), options: None,
    };

    if !hub.send_to_agent(&agent_id, &msg) {
        drop(hub);
        let db = state.db.clone();
        let rid = run_id.clone();
        let _ = tokio::task::spawn_blocking(move || { if let Ok(c) = db.get() { let _ = delete_run(&c, &rid); } }).await;
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable before the action could be executed" }))).into_response();
    }

    if let Ok(conn) = state.db.get() {
        agent_hub::broadcast_run_snapshot(&hub, &conn, &run_id, Some(&turn_id));
    }
    drop(hub);

    (StatusCode::OK, Json(serde_json::json!({ "runId": run_id }))).into_response()
}
