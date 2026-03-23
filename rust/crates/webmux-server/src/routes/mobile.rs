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
    let version = state.mobile_version_resolver.resolve().await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "latestVersion": version.latest_version,
            "downloadUrl": version.download_url,
            "minVersion": version.min_version,
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

#[cfg(test)]
mod tests {
    use super::routes;
    use crate::db;
    use crate::mobile_version::{MobileVersionConfig, MobileVersionResolver};
    use crate::state::{AppState, ServerConfig};
    use crate::ws::agent_hub::AgentHub;
    use axum::body::{Body, to_bytes};
    use http::{Request, StatusCode};
    use serde_json::Value;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[tokio::test]
    async fn mobile_version_endpoint_uses_resolver_output() {
        let state = build_test_state(
            ServerConfig {
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
            },
            MobileVersionResolver::new(
                None,
                MobileVersionConfig {
                    latest_version: Some("1.2.3".to_string()),
                    download_url: Some("https://example.com/webmux.apk".to_string()),
                    min_version: Some("1.0.0".to_string()),
                },
            ),
        );

        let response = routes()
            .with_state(state)
            .oneshot(
                Request::builder()
                    .uri("/mobile/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["latestVersion"], "1.2.3");
        assert_eq!(
            payload["downloadUrl"],
            "https://example.com/webmux.apk"
        );
        assert_eq!(payload["minVersion"], "1.0.0");
    }

    fn build_test_state(
        config: ServerConfig,
        resolver: MobileVersionResolver,
    ) -> Arc<AppState> {
        let db_path = std::env::temp_dir().join(format!(
            "webmux-mobile-version-test-{}.db",
            Uuid::new_v4()
        ));
        let db = db::create_pool(db_path.to_str().unwrap()).unwrap();
        let conn = db.get().unwrap();
        db::init_db(&conn).unwrap();

        Arc::new(AppState {
            db,
            hub: Arc::new(RwLock::new(AgentHub::new())),
            config: Arc::new(config),
            mobile_version_resolver: Arc::new(resolver),
        })
    }
}
