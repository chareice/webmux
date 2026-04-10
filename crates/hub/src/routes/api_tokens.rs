use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::{self, AuthUser};
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
struct CreateApiTokenRequest {
    name: String,
}

#[derive(Serialize)]
struct ApiTokenResponse {
    id: String,
    name: String,
    created_at: i64,
    last_used_at: Option<i64>,
    expires_at: Option<i64>,
}

#[derive(Serialize)]
struct CreateApiTokenResponse {
    id: String,
    name: String,
    token: String,
    created_at: i64,
}

async fn list_tokens(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<ApiTokenResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let tokens = db::tokens::list_api_tokens_by_user(&conn, &auth_user.user_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let response: Vec<ApiTokenResponse> = tokens
        .into_iter()
        .map(|t| ApiTokenResponse {
            id: t.id,
            name: t.name,
            created_at: t.created_at,
            last_used_at: t.last_used_at,
            expires_at: t.expires_at,
        })
        .collect();

    Ok(Json(response))
}

async fn create_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateApiTokenRequest>,
) -> Result<Json<CreateApiTokenResponse>, (StatusCode, Json<serde_json::Value>)> {
    // Generate wmx_ + 2 UUIDs
    let raw_token = format!(
        "wmx_{}{}",
        uuid::Uuid::new_v4().as_simple(),
        uuid::Uuid::new_v4().as_simple()
    );
    let token_hash = auth::hash_token(&raw_token);
    let id = uuid::Uuid::new_v4().to_string();

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    db::tokens::create_api_token(&conn, &id, &auth_user.user_id, &req.name, &token_hash, None)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("DB error: {e}")})),
            )
        })?;

    let created_at = db::now_ms();

    Ok(Json(CreateApiTokenResponse {
        id,
        name: req.name,
        token: raw_token,
        created_at,
    }))
}

async fn delete_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(token_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    db::tokens::delete_api_token(&conn, &token_id, &auth_user.user_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/api-tokens", get(list_tokens).post(create_token))
        .route("/api/auth/api-tokens/{id}", delete(delete_token))
}
