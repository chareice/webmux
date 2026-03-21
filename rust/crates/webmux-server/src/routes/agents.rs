use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use serde::Deserialize;
use webmux_shared::{AgentInfo, AgentListResponse, AgentStatus, CreateRegistrationTokenResponse, RegisterAgentRequest, RegisterAgentResponse, ServerToAgentMessage};

use crate::auth::{AuthUser, hash_password, hash_token, generate_registration_token};
use crate::db::agents::{
    create_agent, create_registration_token, consume_registration_token,
    delete_agent, find_agent_by_id, find_agents_by_user_id, rename_agent,
    CreateAgentOpts, CreateRegistrationTokenOpts,
};
use crate::state::AppState;
use crate::ws::agent_hub;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTokenRequest {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAgentRequest {
    pub name: Option<String>,
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/agents", get(list_agents))
        .route("/agents/{id}", delete(delete_agent_handler))
        .route("/agents/{id}", patch(rename_agent_handler))
        .route("/agents/register-token", post(create_token))
        .route("/agents/register", post(register_agent))
        .route("/agents/{id}/repositories", get(browse_repositories))
        .route("/agents/{id}/instructions", get(read_instructions))
        .route("/agents/{id}/instructions", axum::routing::put(write_instructions))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/agents
async fn list_agents(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        find_agents_by_user_id(&conn, &user_id).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(agents)) => {
            let hub = state.hub.read().await;
            let agent_infos: Vec<AgentInfo> = agents
                .iter()
                .map(|a| AgentInfo {
                    id: a.id.clone(),
                    name: a.name.clone(),
                    status: if hub.is_agent_online(&a.id) {
                        AgentStatus::Online
                    } else {
                        AgentStatus::Offline
                    },
                    last_seen_at: a.last_seen_at.map(|ts| (ts / 1000) as f64),
                })
                .collect();
            (StatusCode::OK, Json(serde_json::to_value(AgentListResponse { agents: agent_infos }).unwrap())).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// DELETE /api/agents/:id
async fn delete_agent_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => Err((StatusCode::FORBIDDEN, "Not your agent".to_string())),
            Some(_) => Ok(()),
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {
            // Disconnect if online, then delete
            {
                let mut hub = state.hub.write().await;
                agent_hub::on_agent_disconnect(&mut hub, &state.db, &id);
            }
            let db = state.db.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = db.get() { let _ = delete_agent(&conn, &id); }
            }).await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err((status, msg))) => {
            (status, Json(serde_json::json!({ "error": msg }))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// PATCH /api/agents/:id
async fn rename_agent_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<RenameAgentRequest>,
) -> impl IntoResponse {
    let name = body.name.as_deref().map(|s| s.trim()).unwrap_or("");
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing name" }))).into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let name_owned = name.to_string();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => return Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => return Err((StatusCode::FORBIDDEN, "Not your agent".to_string())),
            _ => {}
        }
        rename_agent(&conn, &id, &name_owned).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err((status, msg))) => {
            (status, Json(serde_json::json!({ "error": msg }))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/tokens
async fn create_token(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    body: Option<Json<CreateTokenRequest>>,
) -> impl IntoResponse {
    let agent_name = body.and_then(|b| b.name.clone()).unwrap_or_else(|| "unnamed".to_string());
    let plain_token = generate_registration_token();
    let token_hash = hash_token(&plain_token);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let expires_at = now_ms + 60 * 60 * 1000;

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        create_registration_token(
            &conn,
            CreateRegistrationTokenOpts {
                user_id: &user_id,
                agent_name: &agent_name,
                token_hash: &token_hash,
                expires_at,
            },
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    }).await;

    match result {
        Ok(Ok(())) => {
            let resp = CreateRegistrationTokenResponse { token: plain_token, expires_at: expires_at as f64 };
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/agents/register
async fn register_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterAgentRequest>,
) -> impl IntoResponse {
    let token = body.token.trim().to_string();
    if token.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Missing token" }))).into_response();
    }

    let token_hash = hash_token(&token);
    let agent_secret = uuid::Uuid::new_v4().to_string();
    let secret_for_hash = agent_secret.clone();

    let hash_result = tokio::task::spawn_blocking(move || hash_password(&secret_for_hash)).await;
    let agent_secret_hash = match hash_result {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let db = state.db.clone();
    let agent_name = body.name.clone().unwrap_or_default();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let reg_token = consume_registration_token(&conn, &token_hash).map_err(|e| e.to_string())?;
        match reg_token {
            None => Err("Invalid, expired, or already used registration token".to_string()),
            Some(reg) => {
                let name = if agent_name.is_empty() { reg.agent_name.clone() } else { agent_name };
                let agent = create_agent(&conn, CreateAgentOpts {
                    user_id: &reg.user_id,
                    name: &name,
                    agent_secret_hash: &agent_secret_hash,
                }).map_err(|e| e.to_string())?;
                Ok(agent.id)
            }
        }
    }).await;

    match result {
        Ok(Ok(agent_id)) => {
            let resp = RegisterAgentResponse { agent_id, agent_secret };
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Ok(Err(e)) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Instructions read/write
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ReadInstructionsQuery {
    pub tool: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WriteInstructionsBody {
    pub tool: Option<String>,
    pub content: Option<String>,
}

/// GET /api/agents/:id/instructions — read global instructions for a tool
async fn read_instructions(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ReadInstructionsQuery>,
) -> impl IntoResponse {
    let tool = match query.tool.as_deref() {
        Some("claude") | Some("codex") => query.tool.as_deref().unwrap(),
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Query param \"tool\" must be \"claude\" or \"codex\"" }))).into_response(),
    };

    // Verify ownership
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => Err((StatusCode::FORBIDDEN, "Not your agent".to_string())),
            Some(_) => Ok(()),
        }
    }).await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let request_id = uuid::Uuid::new_v4().to_string();

    let tool_enum: webmux_shared::RunTool = serde_json::from_str(&format!("\"{}\"", tool)).unwrap();
    let msg = ServerToAgentMessage::ReadInstructions {
        request_id: request_id.clone(),
        tool: tool_enum,
    };
    if !hub.send_to_agent(&id, &msg) {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable" }))).into_response();
    }

    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id, &id, tx);
    }

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(value))) => (StatusCode::OK, Json(value)).into_response(),
        Ok(Ok(Err(error))) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))).into_response(),
        Ok(Err(_)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal error" }))).into_response(),
        Err(_) => (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({ "error": "Read instructions timed out" }))).into_response(),
    }
}

/// PUT /api/agents/:id/instructions — write global instructions for a tool
async fn write_instructions(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<WriteInstructionsBody>,
) -> impl IntoResponse {
    let tool = match body.tool.as_deref() {
        Some("claude") | Some("codex") => body.tool.as_deref().unwrap(),
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "\"tool\" must be \"claude\" or \"codex\"" }))).into_response(),
    };

    let content = match &body.content {
        Some(c) => c.clone(),
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "\"content\" must be a string" }))).into_response(),
    };

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => Err((StatusCode::FORBIDDEN, "Not your agent".to_string())),
            Some(_) => Ok(()),
        }
    }).await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let request_id = uuid::Uuid::new_v4().to_string();

    let tool_enum: webmux_shared::RunTool = serde_json::from_str(&format!("\"{}\"", tool)).unwrap();
    let msg = ServerToAgentMessage::WriteInstructions {
        request_id: request_id.clone(),
        tool: tool_enum,
        content,
    };
    if !hub.send_to_agent(&id, &msg) {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable" }))).into_response();
    }

    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id, &id, tx);
    }

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(_))) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Ok(Err(error))) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))).into_response(),
        Ok(Err(_)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal error" }))).into_response(),
        Err(_) => (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({ "error": "Write instructions timed out" }))).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Repository browse
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RepositoryBrowseQuery {
    pub path: Option<String>,
}

/// GET /api/agents/:id/repositories — browse repositories on the agent
async fn browse_repositories(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<RepositoryBrowseQuery>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => Err((StatusCode::FORBIDDEN, "Not your agent".to_string())),
            Some(_) => Ok(()),
        }
    }).await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Agent is offline" }))).into_response();
    }

    // Create a oneshot channel to receive the response
    let (tx, rx) = tokio::sync::oneshot::channel();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Send repository-browse command to agent
    let msg = ServerToAgentMessage::RepositoryBrowse {
        request_id: request_id.clone(),
        path: query.path,
    };
    if !hub.send_to_agent(&id, &msg) {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Agent became unavailable" }))).into_response();
    }

    // Register the pending command (requires write lock)
    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id, &id, tx);
    }

    // Wait for the response with a timeout
    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(value))) => (StatusCode::OK, Json(value)).into_response(),
        Ok(Ok(Err(error))) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": error }))).into_response(),
        Ok(Err(_)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal error" }))).into_response(),
        Err(_) => (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({ "error": "Repository browse timed out" }))).into_response(),
    }
}
