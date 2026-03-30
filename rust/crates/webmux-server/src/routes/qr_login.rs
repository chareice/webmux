use std::sync::Arc;

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::post};
use serde::Deserialize;

use crate::auth::{sign_jwt, AuthUser};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmQrRequest {
    session_id: String,
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/qr/create", post(create_qr_session))
        .route("/auth/qr/confirm", post(confirm_qr_session))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/auth/qr/create — create a new QR login session (no auth required)
async fn create_qr_session(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let db = state.db.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        crate::db::qr_login_sessions::create_qr_session(&conn).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(session)) => {
            let base_url = state.config.base_url.as_deref().unwrap_or("");
            let qr_url = format!("{}/auth/qr?s={}", base_url, session.id);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "sessionId": session.id,
                    "qrUrl": qr_url,
                })),
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

/// POST /api/auth/qr/confirm — confirm a QR login session (auth required)
async fn confirm_qr_session(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<ConfirmQrRequest>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let session_id = body.session_id.clone();

    // Validate session exists, is pending, and not expired
    let validation = tokio::task::spawn_blocking({
        let db = db.clone();
        let sid = session_id.clone();
        move || {
            let conn = db.get().map_err(|e| e.to_string())?;
            let session = crate::db::qr_login_sessions::find_qr_session(&conn, &sid)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(session)
        }
    })
    .await;

    let session = match validation {
        Ok(Ok(Some(s))) => s,
        Ok(Ok(None)) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Session not found" })),
            )
                .into_response();
        }
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
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

    if session.status != "pending" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Session is not pending" })),
        )
            .into_response();
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    if now_ms > session.expires_at {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Session has expired" })),
        )
            .into_response();
    }

    // Confirm the session in DB
    let user_id = auth_user.user_id.clone();
    let confirm_result = tokio::task::spawn_blocking({
        let db = db.clone();
        let sid = session_id.clone();
        let uid = user_id.clone();
        move || {
            let conn = db.get().map_err(|e| e.to_string())?;
            crate::db::qr_login_sessions::confirm_qr_session(&conn, &sid, &uid)
                .map_err(|e| e.to_string())
        }
    })
    .await;

    match confirm_result {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Failed to confirm session" })),
            )
                .into_response();
        }
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
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
    }

    // Generate JWT for the confirming user
    let token = sign_jwt(&user_id, &state.config.jwt_secret);

    // Push confirmed message to the QR WebSocket client via hub
    let message = serde_json::json!({
        "type": "confirmed",
        "token": token,
    })
    .to_string();

    {
        let hub = state.qr_hub.read().await;
        hub.send(&session_id, message);
    }

    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}
