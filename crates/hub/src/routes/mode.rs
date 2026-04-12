use crate::{auth::AuthUser, AppState};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
struct ModeResponse {
    controller_device_id: Option<String>,
}

#[derive(Deserialize)]
struct ModeRequest {
    machine_id: String,
    device_id: String,
}

async fn get_mode(
    user: AuthUser,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Result<Json<ModeResponse>, (StatusCode, String)> {
    let machine_id = params.get("machine_id").ok_or((
        StatusCode::BAD_REQUEST,
        "machine_id is required".to_string(),
    ))?;

    if !state
        .manager
        .user_can_access_machine(&user.user_id, machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    Ok(Json(ModeResponse {
        controller_device_id: state.manager.get_controller(&user.user_id, machine_id),
    }))
}

async fn request_control(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Result<Json<ModeResponse>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&user.user_id, &body.machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    state
        .manager
        .request_control(&user.user_id, &body.machine_id, &body.device_id);
    Ok(Json(ModeResponse {
        controller_device_id: Some(body.device_id),
    }))
}

async fn release_control(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Result<Json<ModeResponse>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&user.user_id, &body.machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    state
        .manager
        .release_control(&user.user_id, &body.machine_id, &body.device_id);
    Ok(Json(ModeResponse {
        controller_device_id: state
            .manager
            .get_controller(&user.user_id, &body.machine_id),
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/mode", get(get_mode))
        .route("/api/mode/control", post(request_control))
        .route("/api/mode/release", post(release_control))
}
