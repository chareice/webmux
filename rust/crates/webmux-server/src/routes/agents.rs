use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use serde::Deserialize;
use webmux_shared::{
    AgentInfo, AgentListResponse, AgentStatus, CreateRegistrationTokenResponse,
    ImportableSessionListResponse, RegisterAgentRequest, RegisterAgentResponse,
    RunTool, ServerToAgentMessage,
};

use crate::auth::{AuthUser, generate_registration_token, hash_password, hash_token};
use crate::db::agents::{
    CreateAgentOpts, CreateRegistrationTokenOpts, consume_registration_token, create_agent,
    create_registration_token, delete_agent, find_agent_by_id, find_agents_by_user_id,
    rename_agent,
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
        .route("/agents/{id}/importable-sessions", get(list_importable_sessions))
        .route("/agents/{id}/instructions", get(read_instructions))
        .route(
            "/agents/{id}/instructions",
            axum::routing::put(write_instructions),
        )
        .route(
            "/agents/{id}/instructions/{tool}",
            get(read_instructions_with_path_tool),
        )
        .route(
            "/agents/{id}/instructions/{tool}",
            axum::routing::put(write_instructions_with_path_tool),
        )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/agents
async fn list_agents(State(state): State<Arc<AppState>>, auth_user: AuthUser) -> impl IntoResponse {
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
            (
                StatusCode::OK,
                Json(
                    serde_json::to_value(AgentListResponse {
                        agents: agent_infos,
                    })
                    .unwrap(),
                ),
            )
                .into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
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
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                Err((StatusCode::FORBIDDEN, "Not your agent".to_string()))
            }
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
                if let Ok(conn) = db.get() {
                    let _ = delete_agent(&conn, &id);
                }
            })
            .await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(Err((status, msg))) => {
            (status, Json(serde_json::json!({ "error": msg }))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
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
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing name" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let name_owned = name.to_string();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => return Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                return Err((StatusCode::FORBIDDEN, "Not your agent".to_string()));
            }
            _ => {}
        }
        rename_agent(&conn, &id, &name_owned)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err((status, msg))) => {
            (status, Json(serde_json::json!({ "error": msg }))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// POST /api/agents/tokens
async fn create_token(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    body: Option<Json<CreateTokenRequest>>,
) -> impl IntoResponse {
    let agent_name = body
        .and_then(|b| b.name.clone())
        .unwrap_or_else(|| "unnamed".to_string());
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
        )
        .map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    })
    .await;

    match result {
        Ok(Ok(())) => {
            let resp = CreateRegistrationTokenResponse {
                token: plain_token,
                expires_at: expires_at as f64,
                server_url: state.config.base_url.clone(),
            };
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// POST /api/agents/register
async fn register_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterAgentRequest>,
) -> impl IntoResponse {
    let token = body.token.trim().to_string();
    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing token" })),
        )
            .into_response();
    }

    let token_hash = hash_token(&token);
    let agent_secret = uuid::Uuid::new_v4().to_string();
    let secret_for_hash = agent_secret.clone();

    let hash_result = tokio::task::spawn_blocking(move || hash_password(&secret_for_hash)).await;
    let agent_secret_hash = match hash_result {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    let agent_name = body.name.clone().unwrap_or_default();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let reg_token =
            consume_registration_token(&conn, &token_hash).map_err(|e| e.to_string())?;
        match reg_token {
            None => Err("Invalid, expired, or already used registration token".to_string()),
            Some(reg) => {
                let name = if agent_name.is_empty() {
                    reg.agent_name.clone()
                } else {
                    agent_name
                };
                let agent = create_agent(
                    &conn,
                    CreateAgentOpts {
                        user_id: &reg.user_id,
                        name: &name,
                        agent_secret_hash: &agent_secret_hash,
                    },
                )
                .map_err(|e| e.to_string())?;
                Ok(agent.id)
            }
        }
    })
    .await;

    match result {
        Ok(Ok(agent_id)) => {
            let resp = RegisterAgentResponse {
                agent_id,
                agent_secret,
            };
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
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
    read_instructions_inner(state, auth_user, id, query.tool).await
}

async fn read_instructions_with_path_tool(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((id, tool)): Path<(String, String)>,
) -> impl IntoResponse {
    read_instructions_inner(state, auth_user, id, Some(tool)).await
}

async fn read_instructions_inner(
    state: Arc<AppState>,
    auth_user: AuthUser,
    id: String,
    tool: Option<String>,
) -> axum::response::Response {
    let tool = match tool.as_deref() {
        Some("claude") | Some("codex") => tool.as_deref().unwrap(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "\"tool\" must be \"claude\" or \"codex\"" })),
            )
                .into_response();
        }
    };

    // Verify ownership
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                Err((StatusCode::FORBIDDEN, "Not your agent".to_string()))
            }
            Some(_) => Ok(()),
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Agent is offline" })),
        )
            .into_response();
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let request_id = uuid::Uuid::new_v4().to_string();

    let tool_enum: webmux_shared::RunTool = serde_json::from_str(&format!("\"{}\"", tool)).unwrap();
    let msg = ServerToAgentMessage::ReadInstructions {
        request_id: request_id.clone(),
        tool: tool_enum,
    };
    if !hub.send_to_agent(&id, &msg) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "Agent became unavailable" })),
        )
            .into_response();
    }

    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id, &id, tx);
    }

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(value))) => (StatusCode::OK, Json(value)).into_response(),
        Ok(Ok(Err(error))) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Internal error" })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Read instructions timed out" })),
        )
            .into_response(),
    }
}

/// PUT /api/agents/:id/instructions — write global instructions for a tool
async fn write_instructions(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<WriteInstructionsBody>,
) -> impl IntoResponse {
    write_instructions_inner(state, auth_user, id, body).await
}

async fn write_instructions_with_path_tool(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((id, tool)): Path<(String, String)>,
    Json(mut body): Json<WriteInstructionsBody>,
) -> impl IntoResponse {
    body.tool = Some(tool);
    write_instructions_inner(state, auth_user, id, body).await
}

async fn write_instructions_inner(
    state: Arc<AppState>,
    auth_user: AuthUser,
    id: String,
    body: WriteInstructionsBody,
) -> axum::response::Response {
    let tool = match body.tool.as_deref() {
        Some("claude") | Some("codex") => body.tool.as_deref().unwrap(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "\"tool\" must be \"claude\" or \"codex\"" })),
            )
                .into_response();
        }
    };

    let content = match &body.content {
        Some(c) => c.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "\"content\" must be a string" })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                Err((StatusCode::FORBIDDEN, "Not your agent".to_string()))
            }
            Some(_) => Ok(()),
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Agent is offline" })),
        )
            .into_response();
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
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "Agent became unavailable" })),
        )
            .into_response();
    }

    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id, &id, tx);
    }

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(Ok(_))) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Ok(Err(error))) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Internal error" })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Write instructions timed out" })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Repository browse
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RepositoryBrowseQuery {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportableSessionsQuery {
    pub tool: String,
    pub repo_path: String,
}

/// GET /api/agents/:id/importable-sessions — list locally resumable tool sessions
async fn list_importable_sessions(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ImportableSessionsQuery>,
) -> impl IntoResponse {
    let tool = match query.tool.as_str() {
        "claude" => RunTool::Claude,
        "codex" => RunTool::Codex,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "\"tool\" must be \"claude\" or \"codex\"" })),
            )
                .into_response();
        }
    };

    if query.repo_path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "\"repoPath\" is required" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let id2 = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), (StatusCode, String)> {
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                Err((StatusCode::FORBIDDEN, "Not your agent".to_string()))
            }
            Some(_) => Ok(()),
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Agent is offline" })),
        )
            .into_response();
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let request_id = uuid::Uuid::new_v4().to_string();
    drop(hub);
    {
        let mut hub = state.hub.write().await;
        hub.register_pending_command(request_id.clone(), &id, tx);
    }

    let hub = state.hub.read().await;
    let msg = ServerToAgentMessage::ListImportableSessions {
        request_id: request_id.clone(),
        tool,
        repo_path: query.repo_path,
    };
    if !hub.send_to_agent(&id, &msg) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "Agent became unavailable" })),
        )
            .into_response();
    }
    drop(hub);

    match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(Ok(Ok(value))) => {
            let sessions = value
                .get("sessions")
                .cloned()
                .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
            let payload = ImportableSessionListResponse {
                sessions: serde_json::from_value(sessions).unwrap_or_default(),
            };
            (StatusCode::OK, Json(serde_json::to_value(payload).unwrap())).into_response()
        }
        Ok(Ok(Err(error))) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Internal error" })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Importable session lookup timed out" })),
        )
            .into_response(),
    }
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
        let conn = db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let agent = find_agent_by_id(&conn, &id2)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        match agent {
            None => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
            Some(a) if a.user_id != user_id => {
                Err((StatusCode::FORBIDDEN, "Not your agent".to_string()))
            }
            Some(_) => Ok(()),
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err((status, msg))) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let hub = state.hub.read().await;
    if !hub.is_agent_online(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Agent is offline" })),
        )
            .into_response();
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
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "Agent became unavailable" })),
        )
            .into_response();
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
        Ok(Ok(Err(error))) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Internal error" })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Repository browse timed out" })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::routes;
    use crate::auth::sign_jwt;
    use crate::db;
    use crate::mobile_version::{MobileVersionConfig, MobileVersionResolver};
    use crate::state::{AppState, ServerConfig};
    use crate::ws::agent_hub::AgentHub;
    use axum::body::{Body, to_bytes};
    use http::{Request, StatusCode};
    use serde_json::Value;
    use std::sync::Arc;
    use tokio::sync::{RwLock, mpsc};
    use tower::ServiceExt;
    use uuid::Uuid;
    use webmux_shared::{
        AgentMessage, ImportableSessionSummary, ImportableSessionsResultPayload, RunTool,
        ServerToAgentMessage,
    };

    #[tokio::test]
    async fn importable_sessions_route_returns_agent_results() {
        let state = build_test_state();
        seed_user_and_agent(&state);

        let (agent_tx, mut agent_rx) = mpsc::unbounded_channel::<String>();
        {
            let mut hub = state.hub.write().await;
            hub.register_agent("agent-1", "user-1", "Test Agent", agent_tx);
        }

        let state_for_agent = state.clone();
        tokio::spawn(async move {
            if let Some(raw) = agent_rx.recv().await {
                let msg: ServerToAgentMessage = serde_json::from_str(&raw).unwrap();
                let ServerToAgentMessage::ListImportableSessions { request_id, .. } = msg else {
                    panic!("unexpected message type");
                };

                let payload = AgentMessage::ImportableSessionsResult(
                    ImportableSessionsResultPayload::Ok {
                        request_id,
                        ok: serde_json::Value::Bool(true),
                        tool: RunTool::Codex,
                        sessions: vec![ImportableSessionSummary {
                            id: "thread-1".to_string(),
                            title: "Imported session".to_string(),
                            subtitle: Some("Continue here".to_string()),
                            repo_path: "/repo".to_string(),
                            updated_at: 1_764_215_046_000_f64,
                        }],
                    },
                );

                let mut hub = state_for_agent.hub.write().await;
                crate::ws::agent_hub::handle_agent_message(
                    &mut hub,
                    &state_for_agent.db,
                    "agent-1",
                    payload,
                );
            }
        });

        let token = sign_jwt("user-1", "test-secret");
        let response = routes()
            .with_state(state)
            .oneshot(
                Request::builder()
                    .uri("/agents/agent-1/importable-sessions?tool=codex&repoPath=%2Frepo")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["sessions"][0]["id"], "thread-1");
        assert_eq!(payload["sessions"][0]["title"], "Imported session");
    }

    #[tokio::test]
    async fn importable_sessions_route_rejects_unknown_tool() {
        let state = build_test_state();
        seed_user_and_agent(&state);
        let token = sign_jwt("user-1", "test-secret");

        let response = routes()
            .with_state(state)
            .oneshot(
                Request::builder()
                    .uri("/agents/agent-1/importable-sessions?tool=unknown&repoPath=%2Frepo")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    fn build_test_state() -> Arc<AppState> {
        let db_path = std::env::temp_dir().join(format!(
            "webmux-agent-routes-test-{}.db",
            Uuid::new_v4()
        ));
        let db = db::create_pool(db_path.to_str().unwrap()).unwrap();
        let conn = db.get().unwrap();
        db::init_db(&conn).unwrap();

        Arc::new(AppState {
            db,
            hub: Arc::new(RwLock::new(AgentHub::new())),
            config: Arc::new(ServerConfig {
                jwt_secret: "test-secret".to_string(),
                github_client_id: None,
                github_client_secret: None,
                google_client_id: None,
                google_client_secret: None,
                base_url: None,
                dev_mode: false,
                agent_package_name: None,
                agent_target_version: None,
                agent_min_version: None,
                mobile_latest_version: None,
                mobile_download_url: None,
                mobile_min_version: None,
                firebase_service_account_base64: None,
            }),
            mobile_version_resolver: Arc::new(MobileVersionResolver::new(
                None,
                MobileVersionConfig {
                    latest_version: None,
                    download_url: None,
                    min_version: None,
                },
            )),
        })
    }

    fn seed_user_and_agent(state: &Arc<AppState>) {
        let conn = state.db.get().unwrap();
        conn.execute(
            "INSERT INTO users (id, provider, provider_id, display_name, role, created_at)
             VALUES ('user-1', 'dev', 'user-1', 'User', 'user', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (id, user_id, name, agent_secret_hash, status, created_at)
             VALUES ('agent-1', 'user-1', 'Agent', 'hash', 'online', 0)",
            [],
        )
        .unwrap();
    }
}
