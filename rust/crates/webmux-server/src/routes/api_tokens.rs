use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use webmux_shared::{
    ApiTokenInfo, ApiTokenListResponse, CreateApiTokenRequest, CreateApiTokenResponse,
};

use crate::auth::{AuthUser, hash_token};
use crate::db::api_tokens::{create_api_token, delete_api_token, find_api_tokens_by_user_id};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/api-tokens", post(create_api_token_handler))
        .route("/auth/api-tokens", get(list_api_tokens_handler))
        .route("/auth/api-tokens/{id}", delete(revoke_api_token_handler))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/auth/api-tokens
async fn create_api_token_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<CreateApiTokenRequest>,
) -> impl IntoResponse {
    if body.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "name must not be empty" })),
        )
            .into_response();
    }

    let raw_token = format!(
        "wmx_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let token_hash = hash_token(&raw_token);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let expires_at = body
        .expires_in_days
        .map(|days| now_ms + days * 24 * 60 * 60 * 1000);

    let id = uuid::Uuid::new_v4().to_string();
    let user_id = auth_user.user_id.clone();
    let name = body.name.clone();
    let db = state.db.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        create_api_token(&conn, &id, &user_id, &name, &token_hash, expires_at)
            .map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(row)) => (
            StatusCode::OK,
            Json(
                serde_json::to_value(CreateApiTokenResponse {
                    id: row.id,
                    name: row.name,
                    token: raw_token,
                })
                .unwrap(),
            ),
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

/// GET /api/auth/api-tokens
async fn list_api_tokens_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        find_api_tokens_by_user_id(&conn, &user_id).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(rows)) => {
            let tokens: Vec<ApiTokenInfo> = rows
                .into_iter()
                .map(|r| ApiTokenInfo {
                    id: r.id,
                    name: r.name,
                    created_at: (r.created_at as f64) / 1000.0,
                    last_used_at: r.last_used_at.map(|ts| (ts as f64) / 1000.0),
                    expires_at: r.expires_at.map(|ts| (ts as f64) / 1000.0),
                })
                .collect();
            (
                StatusCode::OK,
                Json(serde_json::to_value(ApiTokenListResponse { tokens }).unwrap()),
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

/// DELETE /api/auth/api-tokens/{id}
async fn revoke_api_token_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(token_id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        delete_api_token(&conn, &token_id, &user_id).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(deleted)) => {
            if deleted > 0 {
                (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "token not found" })),
                )
                    .into_response()
            }
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
