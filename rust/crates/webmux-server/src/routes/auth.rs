use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::auth::{
    AuthUser, exchange_github_code, exchange_google_code, sign_jwt,
};
use crate::db::users::{count_users, create_user, find_user_by_id, find_user_by_provider, CreateUserOpts};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallbackRequest {
    pub code: String,
    #[serde(default)]
    pub state: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/github/callback", post(github_callback))
        .route("/auth/google/callback", post(google_callback))
        .route("/auth/dev", post(dev_login))
        .route("/auth/me", get(me))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/auth/github/callback
async fn github_callback(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OAuthCallbackRequest>,
) -> impl IntoResponse {
    if state.config.dev_mode {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "GitHub OAuth is not available in dev mode" })),
        )
            .into_response();
    }

    let code = body.code.trim();
    if code.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing code parameter" })),
        )
            .into_response();
    }

    let client_id = match &state.config.github_client_id {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "GitHub OAuth is not configured" })),
            )
                .into_response();
        }
    };
    let client_secret = match &state.config.github_client_secret {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "GitHub OAuth is not configured" })),
            )
                .into_response();
        }
    };

    let gh_user = match exchange_github_code(code, &client_id, &client_secret).await {
        Ok(u) => u,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    let jwt_secret = state.config.jwt_secret.clone();
    let provider_id = gh_user.id.to_string();
    let login = gh_user.login.clone();
    let avatar_url = gh_user.avatar_url.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let user = find_user_by_provider(&conn, "github", &provider_id)
            .map_err(|e| e.to_string())?;

        let user = match user {
            Some(u) => u,
            None => {
                let is_first = count_users(&conn).map_err(|e| e.to_string())? == 0;
                create_user(
                    &conn,
                    CreateUserOpts {
                        provider: "github",
                        provider_id: &provider_id,
                        display_name: &login,
                        avatar_url: Some(&avatar_url),
                        role: Some(if is_first { "admin" } else { "user" }),
                    },
                )
                .map_err(|e| e.to_string())?
            }
        };

        let token = sign_jwt(&user.id, &jwt_secret);
        Ok::<_, String>(LoginResponse { token })
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/auth/google/callback
async fn google_callback(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OAuthCallbackRequest>,
) -> impl IntoResponse {
    let client_id = state.config.google_client_id.as_deref().unwrap_or("");
    let client_secret = state.config.google_client_secret.as_deref().unwrap_or("");

    if client_id.is_empty() || client_secret.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Google OAuth is not configured" })),
        )
            .into_response();
    }

    let code = body.code.trim();
    if code.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing code parameter" })),
        )
            .into_response();
    }

    let base_url = state.config.base_url.as_deref().unwrap_or("");
    let redirect_uri = format!("{}/api/auth/google/callback", base_url);

    let google_user = match exchange_google_code(code, client_id, client_secret, &redirect_uri).await {
        Ok(u) => u,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let db = state.db.clone();
    let jwt_secret = state.config.jwt_secret.clone();
    let provider_id = google_user.id.clone();
    let display_name = if google_user.name.is_empty() {
        google_user.email.clone()
    } else {
        google_user.name.clone()
    };
    let picture = google_user.picture.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let user = find_user_by_provider(&conn, "google", &provider_id)
            .map_err(|e| e.to_string())?;

        let user = match user {
            Some(u) => u,
            None => {
                let is_first = count_users(&conn).map_err(|e| e.to_string())? == 0;
                create_user(
                    &conn,
                    CreateUserOpts {
                        provider: "google",
                        provider_id: &provider_id,
                        display_name: &display_name,
                        avatar_url: if picture.is_empty() { None } else { Some(&picture) },
                        role: Some(if is_first { "admin" } else { "user" }),
                    },
                )
                .map_err(|e| e.to_string())?
            }
        };

        let token = sign_jwt(&user.id, &jwt_secret);
        Ok::<_, String>(LoginResponse { token })
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// POST /api/auth/dev
async fn dev_login(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if !state.config.dev_mode {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Not found" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let jwt_secret = state.config.jwt_secret.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let user = find_user_by_provider(&conn, "dev", "0").map_err(|e| e.to_string())?;

        let user = match user {
            Some(u) => u,
            None => create_user(
                &conn,
                CreateUserOpts {
                    provider: "dev",
                    provider_id: "0",
                    display_name: "dev-admin",
                    avatar_url: None,
                    role: Some("admin"),
                },
            )
            .map_err(|e| e.to_string())?,
        };

        let token = sign_jwt(&user.id, &jwt_secret);
        Ok::<_, String>(LoginResponse { token })
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// GET /api/auth/me
async fn me(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        find_user_by_id(&conn, &user_id).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(Some(user))) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "id": user.id,
                "displayName": user.display_name,
                "avatarUrl": user.avatar_url,
                "role": user.role,
            })),
        )
            .into_response(),
        Ok(Ok(None)) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "User not found" })),
        )
            .into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}
