use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::auth::{
    AuthUser, OAuthStatePayload,
    decode_oauth_state, encode_oauth_state, append_auth_token_to_redirect_target,
    exchange_github_code, exchange_google_code,
    get_github_oauth_url, get_google_oauth_url,
    sign_jwt,
};
use crate::db::users::{count_users, create_user, find_user_by_id, find_user_by_provider, CreateUserOpts};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Query / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthRedirectQuery {
    #[serde(default)]
    pub redirect_to: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    #[serde(default)]
    pub code: Option<String>,
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
        .route("/auth/github", get(github_redirect))
        .route("/auth/github/callback", get(github_callback))
        .route("/auth/google", get(google_redirect))
        .route("/auth/google/callback", get(google_callback))
        .route("/auth/dev", get(dev_login))
        .route("/auth/me", get(me))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn redirect_after_auth(base_url: &str, jwt: &str, state: Option<&str>) -> String {
    let payload = decode_oauth_state(state);
    if let Some(target) = payload.redirect_to {
        let url = append_auth_token_to_redirect_target(&target, jwt);
        return url;
    }
    format!("{}/?token={}", base_url, jwt)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/auth/github — redirect to GitHub OAuth
async fn github_redirect(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthRedirectQuery>,
) -> impl IntoResponse {
    if state.config.dev_mode {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "GitHub OAuth is not available in dev mode" })),
        )
            .into_response();
    }

    let client_id = match &state.config.github_client_id {
        Some(id) => id.as_str(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "GitHub OAuth is not configured" })),
            )
                .into_response();
        }
    };

    let base_url = state.config.base_url.as_deref().unwrap_or("");
    let oauth_state = encode_oauth_state(&OAuthStatePayload { redirect_to: query.redirect_to.clone() });
    let url = get_github_oauth_url(client_id, base_url, oauth_state.as_deref());
    Redirect::temporary(&url).into_response()
}

/// GET /api/auth/github/callback — GitHub OAuth callback
async fn github_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthCallbackQuery>,
) -> impl IntoResponse {
    if state.config.dev_mode {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "GitHub OAuth is not available in dev mode" })),
        )
            .into_response();
    }

    let code = match &query.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Missing code parameter" })),
            )
                .into_response();
        }
    };

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

    let gh_user = match exchange_github_code(&code, &client_id, &client_secret).await {
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
    let base_url = state.config.base_url.clone().unwrap_or_default();
    let oauth_state = query.state.clone();
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
        let redirect_url = redirect_after_auth(&base_url, &token, oauth_state.as_deref());
        Ok::<_, String>(redirect_url)
    })
    .await;

    match result {
        Ok(Ok(url)) => Redirect::temporary(&url).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// GET /api/auth/google — redirect to Google OAuth
async fn google_redirect(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthRedirectQuery>,
) -> impl IntoResponse {
    let client_id = match &state.config.google_client_id {
        Some(id) if !id.is_empty() => id.as_str(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Google OAuth is not configured" })),
            )
                .into_response();
        }
    };

    let base_url = state.config.base_url.as_deref().unwrap_or("");
    let oauth_state = encode_oauth_state(&OAuthStatePayload { redirect_to: query.redirect_to.clone() });
    let url = get_google_oauth_url(client_id, base_url, oauth_state.as_deref());
    Redirect::temporary(&url).into_response()
}

/// GET /api/auth/google/callback — Google OAuth callback
async fn google_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthCallbackQuery>,
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

    let code = match &query.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Missing code parameter" })),
            )
                .into_response();
        }
    };

    let base_url = state.config.base_url.as_deref().unwrap_or("");
    let redirect_uri = format!("{}/api/auth/google/callback", base_url);

    let google_user = match exchange_google_code(&code, client_id, client_secret, &redirect_uri).await {
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
    let base_url_owned = state.config.base_url.clone().unwrap_or_default();
    let oauth_state = query.state.clone();
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
        let redirect_url = redirect_after_auth(&base_url_owned, &token, oauth_state.as_deref());
        Ok::<_, String>(redirect_url)
    })
    .await;

    match result {
        Ok(Ok(url)) => Redirect::temporary(&url).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

/// GET /api/auth/dev
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
    let base_url = state.config.base_url.clone().unwrap_or_default();

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
        let redirect_url = redirect_after_auth(&base_url, &token, None);
        Ok::<_, String>(redirect_url)
    })
    .await;

    match result {
        Ok(Ok(url)) => Redirect::temporary(&url).into_response(),
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
