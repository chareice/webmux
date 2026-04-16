use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Missing authentication")]
    MissingAuth,

    #[error("Invalid token")]
    InvalidToken,

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let status = match &self {
            AuthError::MissingAuth | AuthError::InvalidToken => StatusCode::UNAUTHORIZED,
            AuthError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = serde_json::json!({ "error": self.to_string() });
        (status, axum::Json(body)).into_response()
    }
}

// ---------------------------------------------------------------------------
// JWT payload
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtPayload {
    pub sub: String,
    pub exp: i64,
}

/// Legacy JWT payload compatible with TypeScript server format: { userId }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyJwtPayload {
    pub user_id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    pub exp: i64,
    #[serde(default)]
    pub iat: Option<i64>,
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

const JWT_EXPIRY_DAYS: i64 = 7;

/// Create an HS256 JWT that expires in 7 days.
/// Uses { userId } format for compatibility.
pub fn sign_jwt(user_id: &str, secret: &str) -> String {
    let now = Utc::now().timestamp();
    let exp = now + JWT_EXPIRY_DAYS * 24 * 60 * 60;
    let payload = LegacyJwtPayload {
        user_id: user_id.to_string(),
        display_name: None,
        role: None,
        exp,
        iat: Some(now),
    };
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &payload,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("JWT encoding should not fail")
}

/// Verify an HS256 JWT and return the user_id.
/// Supports both { userId } (legacy) and { sub } (standard) formats.
pub fn verify_jwt(token: &str, secret: &str) -> Result<String, AuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp"]);

    // Try legacy { userId } format first
    if let Ok(data) = jsonwebtoken::decode::<LegacyJwtPayload>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ) {
        return Ok(data.claims.user_id);
    }

    // Fall back to standard { sub } format
    let data = jsonwebtoken::decode::<JwtPayload>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AuthError::InvalidToken)?;

    Ok(data.claims.sub)
}

// ---------------------------------------------------------------------------
// Password hashing (bcrypt)
// ---------------------------------------------------------------------------

const BCRYPT_COST: u32 = 10;

/// Hash a password with bcrypt (cost 10).
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    bcrypt::hash(password, BCRYPT_COST).map_err(|e| AuthError::Internal(e.to_string()))
}

/// Verify a plaintext password against a bcrypt hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool, AuthError> {
    bcrypt::verify(password, hash).map_err(|e| AuthError::Internal(e.to_string()))
}

// ---------------------------------------------------------------------------
// Token hashing (SHA-256)
// ---------------------------------------------------------------------------

/// Hash a token with SHA-256 and return the hex string.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Unified bearer token verification (JWT or API token)
// ---------------------------------------------------------------------------

/// Verify a bearer token — either an API token (wmx_ prefix) or a JWT.
/// Returns the user_id on success.
pub fn verify_bearer_token(
    token: &str,
    db: &db::DbPool,
    jwt_secret: &str,
) -> Result<String, AuthError> {
    if token.starts_with("wmx_") {
        // API token path
        let token_hash = hash_token(token);
        let conn = db
            .get()
            .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;
        let row = db::tokens::find_api_token_by_hash(&conn, &token_hash)
            .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?
            .ok_or(AuthError::InvalidToken)?;

        // Check expiry
        if let Some(expires_at) = row.expires_at {
            let now = db::now_ms();
            if now > expires_at {
                return Err(AuthError::InvalidToken);
            }
        }

        // Update last_used_at (fire and forget)
        let _ = db::tokens::update_api_token_last_used(&conn, &row.id);

        Ok(row.user_id)
    } else {
        // JWT path
        verify_jwt(token, jwt_secret)
    }
}

// ---------------------------------------------------------------------------
// Axum extractor — AuthUser
// ---------------------------------------------------------------------------

/// Authenticated user extracted from the `Authorization: Bearer <token>` header.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
}

impl FromRequestParts<crate::AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AuthError::MissingAuth)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AuthError::MissingAuth)?;

        let user_id = verify_bearer_token(token, &state.db, &state.jwt_secret)?;

        Ok(AuthUser { user_id })
    }
}

// ---------------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub id: i64,
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Exchange a GitHub OAuth code for an access token, then fetch the user profile.
pub async fn exchange_github_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
) -> Result<GitHubUser, AuthError> {
    let client = reqwest::Client::new();

    let token_resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?
        .json::<GitHubTokenResponse>()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;

    let access_token = token_resp.access_token.ok_or_else(|| {
        let msg = token_resp
            .error_description
            .or(token_resp.error)
            .unwrap_or_else(|| "no access_token".to_string());
        AuthError::Internal(format!("GitHub OAuth error: {msg}"))
    })?;

    let user: GitHubUser = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "webmux-server")
        .send()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?
        .error_for_status()
        .map_err(|e| AuthError::Internal(format!("GitHub API error: {e}")))?
        .json()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;

    Ok(user)
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUser {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Exchange a Google OAuth code for an access token, then fetch the user profile.
pub async fn exchange_google_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<GoogleUser, AuthError> {
    let client = reqwest::Client::new();

    let token_resp = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;

    let access_token = token_resp.access_token.ok_or_else(|| {
        let msg = token_resp
            .error_description
            .or(token_resp.error)
            .unwrap_or_else(|| "no access_token".to_string());
        AuthError::Internal(format!("Google OAuth error: {msg}"))
    })?;

    let user: GoogleUser = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?
        .error_for_status()
        .map_err(|e| AuthError::Internal(format!("Google API error: {e}")))?
        .json()
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;

    Ok(user)
}

// ---------------------------------------------------------------------------
// OAuth URL helpers
// ---------------------------------------------------------------------------

/// Minimal percent-encoding for URL query values.
fn urlencoded(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                use std::fmt::Write;
                write!(out, "%{b:02X}").unwrap();
            }
        }
    }
    out
}

/// Encode an OAuth state parameter that optionally carries a desktop redirect URL.
pub fn encode_oauth_state(redirect_to: Option<&str>) -> String {
    use base64::Engine;
    let nonce = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "nonce": nonce,
        "redirect_to": redirect_to.unwrap_or(""),
    });
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes())
}

/// Decode an OAuth state parameter and extract the desktop redirect URL (if any).
/// Returns None if the state is missing, malformed, or the redirect_to is empty.
pub fn decode_oauth_state_redirect(state: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(state)
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let redirect_to = json.get("redirect_to")?.as_str()?;
    if redirect_to.is_empty() {
        return None;
    }
    // Only allow loopback addresses to prevent open redirect
    if let Ok(url) = url::Url::parse(redirect_to) {
        let host = url.host_str().unwrap_or("");
        if host == "127.0.0.1" || host == "localhost" || host == "[::1]" {
            return Some(redirect_to.to_string());
        }
    }
    None
}

/// Build the GitHub OAuth authorization URL.
pub fn github_oauth_url(client_id: &str, base_url: &str, redirect_to: Option<&str>) -> String {
    let redirect_uri = format!("{base_url}/api/auth/github/callback");
    let state = encode_oauth_state(redirect_to);
    let query = format!(
        "client_id={}&redirect_uri={}&scope=read%3Auser&state={}",
        urlencoded(client_id),
        urlencoded(&redirect_uri),
        urlencoded(&state)
    );
    format!("https://github.com/login/oauth/authorize?{query}")
}

/// Build the Google OAuth authorization URL.
pub fn google_oauth_url(client_id: &str, base_url: &str, redirect_to: Option<&str>) -> String {
    let redirect_uri = format!("{base_url}/api/auth/google/callback");
    let state = encode_oauth_state(redirect_to);
    let query = format!(
        "client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&state={}",
        urlencoded(client_id),
        urlencoded(&redirect_uri),
        urlencoded(&state)
    );
    format!("https://accounts.google.com/o/oauth2/v2/auth?{query}")
}
