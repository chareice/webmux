use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Json, Redirect},
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::{self, AuthUser};
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
pub struct OAuthRedirectQuery {
    pub redirect_to: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
}

#[derive(Serialize)]
struct MeResponse {
    id: String,
    display_name: String,
    avatar_url: Option<String>,
    role: String,
    provider: String,
}

#[derive(Serialize)]
struct DevLoginResponse {
    token: String,
}

// ── GitHub OAuth ──

async fn github_redirect(
    State(state): State<AppState>,
    Query(query): Query<OAuthRedirectQuery>,
) -> Result<Redirect, (StatusCode, Json<serde_json::Value>)> {
    let client_id = state.github_client_id.as_deref().ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    let url = auth::github_oauth_url(client_id, &state.base_url, query.redirect_to.as_deref());
    Ok(Redirect::temporary(&url))
}

async fn github_callback(
    State(state): State<AppState>,
    Query(query): Query<OAuthCallbackQuery>,
) -> Result<Redirect, (StatusCode, Json<serde_json::Value>)> {
    let code = query.code.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing code parameter"})),
        )
    })?;

    let client_id = state.github_client_id.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "GitHub OAuth not configured"})),
        )
    })?;
    let client_secret = state.github_client_secret.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    let gh_user = auth::exchange_github_code(client_id, client_secret, &code)
        .await
        .map_err(|e| {
            tracing::error!("GitHub OAuth exchange failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
        })?;

    let jwt = upsert_oauth_user_and_sign(
        &state,
        "github",
        &gh_user.id.to_string(),
        &gh_user.login,
        gh_user.avatar_url.as_deref(),
    )?;

    let base = resolve_redirect_base(&state.base_url, query.state.as_deref());
    let redirect_url = format!("{}?token={}", base, jwt);
    Ok(Redirect::temporary(&redirect_url))
}

// ── Google OAuth ──

async fn google_redirect(
    State(state): State<AppState>,
    Query(query): Query<OAuthRedirectQuery>,
) -> Result<Redirect, (StatusCode, Json<serde_json::Value>)> {
    let client_id = state.google_client_id.as_deref().ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Google OAuth not configured"})),
        )
    })?;

    let url = auth::google_oauth_url(client_id, &state.base_url, query.redirect_to.as_deref());
    Ok(Redirect::temporary(&url))
}

async fn google_callback(
    State(state): State<AppState>,
    Query(query): Query<OAuthCallbackQuery>,
) -> Result<Redirect, (StatusCode, Json<serde_json::Value>)> {
    let code = query.code.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing code parameter"})),
        )
    })?;

    let client_id = state.google_client_id.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Google OAuth not configured"})),
        )
    })?;
    let client_secret = state.google_client_secret.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Google OAuth not configured"})),
        )
    })?;

    let redirect_uri = format!("{}/api/auth/google/callback", state.base_url);
    let g_user = auth::exchange_google_code(client_id, client_secret, &code, &redirect_uri)
        .await
        .map_err(|e| {
            tracing::error!("Google OAuth exchange failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
        })?;

    let display_name = g_user.name.as_deref().unwrap_or(&g_user.email);

    let jwt = upsert_oauth_user_and_sign(
        &state,
        "google",
        &g_user.id,
        display_name,
        g_user.picture.as_deref(),
    )?;

    let base = resolve_redirect_base(&state.base_url, query.state.as_deref());
    let redirect_url = format!("{}?token={}", base, jwt);
    Ok(Redirect::temporary(&redirect_url))
}

// ── Dev login ──

async fn dev_login(
    State(state): State<AppState>,
) -> Result<Json<DevLoginResponse>, (StatusCode, Json<serde_json::Value>)> {
    if !state.dev_mode {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Dev mode not enabled"})),
        ));
    }

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    // Find or create dev user
    let user = match db::users::find_user_by_provider(&conn, "dev", "dev-user").map_err(db_err)? {
        Some(u) => u,
        None => {
            let role = if db::users::count_users(&conn).map_err(db_err)? == 0 {
                "admin"
            } else {
                "user"
            };
            let id = uuid::Uuid::new_v4().to_string();
            db::users::create_user(&conn, &id, "dev", "dev-user", "Dev User", None, role)
                .map_err(db_err)?
        }
    };

    let jwt = auth::sign_jwt(&user.id, &state.jwt_secret);
    Ok(Json(DevLoginResponse { token: jwt }))
}

// ── Me endpoint ──

async fn me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<MeResponse>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let user = db::users::find_user_by_id(&conn, &auth_user.user_id)
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "User not found"})),
            )
        })?;

    Ok(Json(MeResponse {
        id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
        provider: user.provider,
    }))
}

// ── Helpers ──

/// Determine the final redirect base URL after OAuth.
/// If the OAuth state carries a valid loopback redirect_to, use that;
/// otherwise fall back to the server's base_url.
fn resolve_redirect_base(base_url: &str, state: Option<&str>) -> String {
    state
        .and_then(auth::decode_oauth_state_redirect)
        .unwrap_or_else(|| base_url.to_string())
}

fn upsert_oauth_user_and_sign(
    state: &AppState,
    provider: &str,
    provider_id: &str,
    display_name: &str,
    avatar_url: Option<&str>,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let user =
        match db::users::find_user_by_provider(&conn, provider, provider_id).map_err(db_err)? {
            Some(u) => u,
            None => {
                // First user gets admin role
                let role = if db::users::count_users(&conn).map_err(db_err)? == 0 {
                    "admin"
                } else {
                    "user"
                };
                let id = uuid::Uuid::new_v4().to_string();
                db::users::create_user(
                    &conn,
                    &id,
                    provider,
                    provider_id,
                    display_name,
                    avatar_url,
                    role,
                )
                .map_err(db_err)?
            }
        };

    let jwt = auth::sign_jwt(&user.id, &state.jwt_secret);
    Ok(jwt)
}

fn db_err(e: rusqlite::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": format!("DB error: {e}")})),
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/github", get(github_redirect))
        .route("/api/auth/github/callback", get(github_callback))
        .route("/api/auth/google", get(google_redirect))
        .route("/api/auth/google/callback", get(google_callback))
        .route("/api/auth/dev", get(dev_login))
        .route("/api/auth/me", get(me))
}
