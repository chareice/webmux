use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use crate::{auth::AuthUser, AppState};

#[derive(Serialize)]
struct ModeResponse {
    controller_device_id: Option<String>,
}

#[derive(Deserialize)]
struct ModeRequest {
    device_id: String,
}

async fn get_mode(
    user: AuthUser,
    State(state): State<AppState>,
) -> Json<ModeResponse> {
    Json(ModeResponse {
        controller_device_id: state.manager.get_controller(&user.user_id),
    })
}

async fn request_control(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Json<ModeResponse> {
    state.manager.request_control(&user.user_id, &body.device_id);
    Json(ModeResponse {
        controller_device_id: Some(body.device_id),
    })
}

async fn release_control(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Json<ModeResponse> {
    state.manager.release_control(&user.user_id, &body.device_id);
    Json(ModeResponse {
        controller_device_id: state.manager.get_controller(&user.user_id),
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/mode", get(get_mode))
        .route("/api/mode/control", post(request_control))
        .route("/api/mode/release", post(release_control))
}
