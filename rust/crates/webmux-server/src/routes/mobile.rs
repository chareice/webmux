use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::db::notifications::{
    delete_notification_device, find_notification_devices_by_user_id, upsert_notification_device,
    UpsertNotificationDeviceOpts,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPushDeviceRequest {
    pub installation_id: Option<String>,
    pub platform: Option<String>,
    pub provider: Option<String>,
    pub push_token: Option<String>,
    pub device_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mobile/version", get(get_version))
        .route("/mobile/push-devices", post(register_push_device))
        .route(
            "/mobile/push-devices/{installation_id}",
            delete(unregister_push_device),
        )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/mobile/version
async fn get_version(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Return version info from config (static or GitHub-fetched)
    let latest_version = state.config.mobile_latest_version.clone();
    let download_url = state.config.mobile_download_url.clone();
    let min_version = state.config.mobile_min_version.clone();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "latestVersion": latest_version,
            "downloadUrl": download_url,
            "minVersion": min_version,
        })),
    )
        .into_response()
}

/// POST /api/mobile/push-devices
async fn register_push_device(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<RegisterPushDeviceRequest>,
) -> impl IntoResponse {
    let installation_id = body
        .installation_id
        .as_deref()
        .map(|s| s.trim())
        .unwrap_or("");
    let platform = body.platform.as_deref().map(|s| s.trim()).unwrap_or("");
    let provider = body.provider.as_deref().map(|s| s.trim()).unwrap_or("");
    let push_token = body.push_token.as_deref().map(|s| s.trim()).unwrap_or("");

    if installation_id.is_empty()
        || platform.is_empty()
        || provider.is_empty()
        || push_token.is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Missing required fields: installationId, platform, provider, pushToken"
            })),
        )
            .into_response();
    }

    if platform != "android" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Only Android push devices are currently supported" })),
        )
            .into_response();
    }

    if provider != "fcm" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Only the FCM push provider is currently supported" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let installation_id = installation_id.to_string();
    let platform = platform.to_string();
    let provider = provider.to_string();
    let push_token = push_token.to_string();
    let device_name = body.device_name.as_deref().map(|s| s.trim().to_string());

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        upsert_notification_device(
            &conn,
            UpsertNotificationDeviceOpts {
                installation_id: &installation_id,
                user_id: &user_id,
                platform: &platform,
                provider: &provider,
                push_token: &push_token,
                device_name: device_name.as_deref(),
            },
        )
        .map_err(|e| e.to_string())?;

        let devices =
            find_notification_devices_by_user_id(&conn, &user_id).map_err(|e| e.to_string())?;
        Ok::<_, String>(devices.len())
    })
    .await;

    match result {
        Ok(Ok(count)) => (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "devices": count })),
        )
            .into_response(),
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

/// DELETE /api/mobile/push-devices/:installationId
async fn unregister_push_device(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(installation_id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        delete_notification_device(&conn, &user_id, &installation_id)
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
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
