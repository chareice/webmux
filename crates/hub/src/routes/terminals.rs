use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use tc_protocol::{DirEntry, MachineInfo, TerminalInfo};

use crate::auth::AuthUser;
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateTerminalRequest {
    pub cwd: String,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

async fn list_machines(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Json<Vec<MachineInfo>> {
    Json(state.manager.list_machines_for_user(&auth_user.user_id).await)
}

async fn list_all_terminals(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Json<Vec<TerminalInfo>> {
    Json(
        state
            .manager
            .list_terminals_for_user(&auth_user.user_id, None)
            .await,
    )
}

async fn list_machine_terminals(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
) -> Result<Json<Vec<TerminalInfo>>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    Ok(Json(
        state
            .manager
            .list_terminals_for_user(&auth_user.user_id, Some(&machine_id))
            .await,
    ))
}

async fn create_terminal(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<CreateTerminalRequest>,
) -> Result<Json<TerminalInfo>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    let startup_command = {
        let conn = state
            .db
            .get()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?;
        crate::db::settings::get_effective_setting(
            &conn,
            &auth_user.user_id,
            "default_startup_command",
        )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?
    };

    state
        .manager
        .create_terminal(&machine_id, &req.cwd, req.cols, req.rows, startup_command)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn destroy_terminal(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((machine_id, terminal_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_terminal(&auth_user.user_id, &machine_id, &terminal_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Terminal not found".to_string()));
    }

    state
        .manager
        .destroy_terminal(&machine_id, &terminal_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

async fn list_directory(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    let path = params.get("path").map(|s| s.as_str()).unwrap_or("~");
    state
        .manager
        .list_directory(&machine_id, path)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn get_machine_stats(
    Path(machine_id): Path<String>,
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return StatusCode::NOT_FOUND.into_response();
    }

    match state.manager.get_machine_stats(&machine_id).await {
        Some(stats) => Json(stats).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/machines", get(list_machines))
        .route("/api/terminals", get(list_all_terminals))
        .route(
            "/api/machines/{machine_id}/terminals",
            get(list_machine_terminals),
        )
        .route(
            "/api/machines/{machine_id}/terminals",
            post(create_terminal),
        )
        .route(
            "/api/machines/{machine_id}/terminals/{terminal_id}",
            delete(destroy_terminal),
        )
        .route("/api/machines/{machine_id}/fs/list", get(list_directory))
        .route("/api/machines/{machine_id}/stats", get(get_machine_stats))
}
