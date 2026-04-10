use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::{self, AuthUser};
use crate::db;
use crate::AppState;

#[derive(Serialize)]
struct RegisterTokenResponse {
    token: String,
}

#[derive(Deserialize)]
struct RegisterMachineRequest {
    token: String,
    name: Option<String>,
}

#[derive(Serialize)]
struct RegisterMachineResponse {
    machine_id: String,
    machine_secret: String,
}

// ── Generate registration token ──

async fn create_register_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<RegisterTokenResponse>, (StatusCode, Json<serde_json::Value>)> {
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash = auth::hash_token(&raw_token);
    let id = uuid::Uuid::new_v4().to_string();
    let expires_at = db::now_ms() + 24 * 60 * 60 * 1000; // 24 hours

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    db::tokens::create_registration_token(&conn, &id, &auth_user.user_id, "", &token_hash, expires_at)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("DB error: {e}")})),
            )
        })?;

    Ok(Json(RegisterTokenResponse { token: raw_token }))
}

// ── Register machine with token ──

async fn register_machine(
    State(state): State<AppState>,
    Json(req): Json<RegisterMachineRequest>,
) -> Result<Json<RegisterMachineResponse>, (StatusCode, Json<serde_json::Value>)> {
    let token_hash = auth::hash_token(&req.token);

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let reg_token = db::tokens::find_registration_token_by_hash(&conn, &token_hash)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("DB error: {e}")})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid registration token"})),
            )
        })?;

    // Check if used
    if reg_token.used {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Registration token already used"})),
        ));
    }

    // Check expiry
    if db::now_ms() > reg_token.expires_at {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Registration token expired"})),
        ));
    }

    // Generate machine credentials
    let machine_id = uuid::Uuid::new_v4().to_string();
    let machine_secret = uuid::Uuid::new_v4().to_string();
    let secret_hash = auth::hash_password(&machine_secret).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Hash error: {e}")})),
        )
    })?;

    let machine_name = req
        .name
        .unwrap_or_else(|| format!("machine-{}", &machine_id[..8]));

    // Create machine record
    db::machines::create_machine(&conn, &machine_id, &reg_token.user_id, &machine_name, &secret_hash)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("DB error: {e}")})),
            )
        })?;

    // Mark token as used
    db::tokens::consume_registration_token(&conn, &reg_token.id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    Ok(Json(RegisterMachineResponse {
        machine_id,
        machine_secret,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/machines/register-token", post(create_register_token))
        .route("/api/machines/register", post(register_machine))
}
