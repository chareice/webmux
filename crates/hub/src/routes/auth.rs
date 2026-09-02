use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Json, Redirect},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::{self, AuthUser};
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthRedirectQuery {
    pub mobile_callback: Option<String>,
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

    let oauth_state = mobile_oauth_state_param(query.mobile_callback.as_deref())?;
    let url = auth::github_oauth_url(client_id, &state.base_url, oauth_state.as_deref());
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

    let redirect_url =
        auth::oauth_success_redirect_url(&state.base_url, &jwt, query.state.as_deref());
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

    let oauth_state = mobile_oauth_state_param(query.mobile_callback.as_deref())?;
    let url = auth::google_oauth_url(client_id, &state.base_url, oauth_state.as_deref());
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

    let redirect_url =
        auth::oauth_success_redirect_url(&state.base_url, &jwt, query.state.as_deref());
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

// ── Which ways in exist ──

#[derive(Serialize)]
struct ProvidersResponse {
    github: bool,
    google: bool,
    /// No OAuth app is configured, so the hub prints a sign-in link on
    /// start and signed-in users can mint one for another device.
    link: bool,
}

/// Public: a login page has to know which buttons to draw before anyone is
/// signed in, and the alternative — drawing every provider and letting the
/// click fail — is what this replaces.
async fn providers(State(state): State<AppState>) -> Json<ProvidersResponse> {
    let github = state.github_client_id.is_some();
    let google = state.google_client_id.is_some();
    Json(ProvidersResponse {
        github,
        google,
        link: !github && !google && !state.dev_mode,
    })
}

#[derive(Serialize)]
struct SessionTokenResponse {
    token: String,
}

/// A fresh session for the caller, to carry to another device — the QR code
/// on the hub's page encodes one so a phone that scans it is signed in, not
/// parked on a login screen with no working button. It is the caller's own
/// identity and nothing more; anyone who can call this already holds an
/// equivalent token.
async fn session_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Json<SessionTokenResponse> {
    Json(SessionTokenResponse {
        token: auth::sign_jwt(&auth_user.user_id, &state.jwt_secret),
    })
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

fn mobile_oauth_state_param(
    mobile_callback: Option<&str>,
) -> Result<Option<String>, (StatusCode, Json<serde_json::Value>)> {
    let Some(callback) = mobile_callback else {
        return Ok(None);
    };

    auth::mobile_oauth_state(callback).map(Some).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid mobile callback"})),
        )
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/github", get(github_redirect))
        .route("/api/auth/github/callback", get(github_callback))
        .route("/api/auth/google", get(google_redirect))
        .route("/api/auth/google/callback", get(google_callback))
        .route("/api/auth/dev", get(dev_login))
        .route("/api/auth/me", get(me))
        .route("/api/auth/providers", get(providers))
        .route("/api/auth/session-token", post(session_token))
}
