use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("bcrypt error: {0}")]
    Bcrypt(#[from] bcrypt::BcryptError),

    #[error("HTTP request error: {0}")]
    Request(#[from] reqwest::Error),

    #[error("OAuth error: {0}")]
    OAuth(String),

    #[error("Missing or invalid authorization header")]
    MissingAuth,

    #[error("Invalid or expired token")]
    InvalidToken,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let status = match &self {
            AuthError::MissingAuth | AuthError::InvalidToken => StatusCode::UNAUTHORIZED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
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
    /// User ID (JWT `sub` claim)
    pub sub: String,
    /// Expiration timestamp (seconds since epoch)
    pub exp: i64,
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

const JWT_EXPIRY_DAYS: i64 = 7;

/// Create an HS256 JWT that expires in 7 days.
pub fn sign_jwt(user_id: &str, secret: &str) -> String {
    let exp = Utc::now().timestamp() + JWT_EXPIRY_DAYS * 24 * 60 * 60;
    let payload = JwtPayload {
        sub: user_id.to_string(),
        exp,
    };
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &payload,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("JWT encoding should not fail")
}

/// Verify an HS256 JWT and return the decoded payload.
pub fn verify_jwt(token: &str, secret: &str) -> Result<JwtPayload, AuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    // The TypeScript side doesn't set an issuer/audience — disable those checks.
    validation.set_required_spec_claims(&["exp", "sub"]);
    let data = jsonwebtoken::decode::<JwtPayload>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

// ---------------------------------------------------------------------------
// Password hashing (bcrypt)
// ---------------------------------------------------------------------------

const BCRYPT_COST: u32 = 10;

/// Hash a password with bcrypt (cost 10).
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    Ok(bcrypt::hash(password, BCRYPT_COST)?)
}

/// Verify a plaintext password against a bcrypt hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    bcrypt::verify(password, hash).unwrap_or(false)
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
// Registration token generation
// ---------------------------------------------------------------------------

/// Generate a random registration token (UUID v4).
pub fn generate_registration_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubUser {
    pub id: i64,
    pub login: String,
    pub avatar_url: String,
}

#[derive(Deserialize)]
struct GithubTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Exchange a GitHub OAuth code for an access token, then fetch the user profile.
pub async fn exchange_github_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<GithubUser, AuthError> {
    let client = reqwest::Client::new();

    // Step 1: exchange code for access token
    let token_resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }))
        .send()
        .await?
        .json::<GithubTokenResponse>()
        .await?;

    let access_token = token_resp.access_token.ok_or_else(|| {
        let msg = token_resp
            .error_description
            .or(token_resp.error)
            .unwrap_or_else(|| "no access_token".to_string());
        AuthError::OAuth(format!("GitHub OAuth error: {msg}"))
    })?;

    // Step 2: fetch user info
    let user: GithubUser = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "webmux-server")
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AuthError::OAuth(format!("GitHub API error: {e}")))?
        .json()
        .await?;

    Ok(GithubUser {
        id: user.id,
        login: user.login,
        avatar_url: user.avatar_url,
    })
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: String,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Exchange a Google OAuth code for an access token, then fetch the user profile.
pub async fn exchange_google_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<GoogleUser, AuthError> {
    let client = reqwest::Client::new();

    // Step 1: exchange code for access token (form-encoded)
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
        .await?
        .json::<GoogleTokenResponse>()
        .await?;

    let access_token = token_resp.access_token.ok_or_else(|| {
        let msg = token_resp
            .error_description
            .or(token_resp.error)
            .unwrap_or_else(|| "no access_token".to_string());
        AuthError::OAuth(format!("Google OAuth error: {msg}"))
    })?;

    // Step 2: fetch user info
    let user: GoogleUser = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AuthError::OAuth(format!("Google API error: {e}")))?
        .json()
        .await?;

    Ok(GoogleUser {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
    })
}

// ---------------------------------------------------------------------------
// OAuth state helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthStatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_to: Option<String>,
}

/// Encode an OAuth state payload as a base64url string.
/// Returns `None` when there is no `redirect_to`.
pub fn encode_oauth_state(payload: &OAuthStatePayload) -> Option<String> {
    let redirect = payload.redirect_to.as_ref()?;
    if redirect.is_empty() {
        return None;
    }
    let json = serde_json::to_string(payload).ok()?;
    Some(base64url_encode(json.as_bytes()))
}

/// Decode an OAuth state string back into an `OAuthStatePayload`.
/// Gracefully returns an empty payload on any failure.
pub fn decode_oauth_state(state: Option<&str>) -> OAuthStatePayload {
    let Some(s) = state else {
        return OAuthStatePayload { redirect_to: None };
    };
    if s.is_empty() {
        return OAuthStatePayload { redirect_to: None };
    }
    let bytes = match base64url_decode(s) {
        Some(b) => b,
        None => return OAuthStatePayload { redirect_to: None },
    };
    let parsed: OAuthStatePayload = match serde_json::from_slice(&bytes) {
        Ok(p) => p,
        Err(_) => return OAuthStatePayload { redirect_to: None },
    };
    if parsed.redirect_to.as_deref().unwrap_or("").is_empty() {
        OAuthStatePayload { redirect_to: None }
    } else {
        parsed
    }
}

/// Append `?token=<jwt>` (or `&token=<jwt>`) to a redirect URL.
pub fn append_auth_token_to_redirect_target(redirect_target: &str, token: &str) -> String {
    if redirect_target.contains('?') {
        format!("{redirect_target}&token={token}")
    } else {
        format!("{redirect_target}?token={token}")
    }
}

// Simple base64url helpers (no padding)
fn base64url_encode(data: &[u8]) -> String {
    let mut out = String::new();
    let standard = base64_encode_standard(data);
    for c in standard.chars() {
        match c {
            '+' => out.push('-'),
            '/' => out.push('_'),
            '=' => {} // strip padding
            _ => out.push(c),
        }
    }
    out
}

fn base64_encode_standard(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() { data[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if i + 1 < data.len() {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if i + 2 < data.len() {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        i += 3;
    }
    result
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    // Convert base64url to standard base64
    let mut std_b64: String = input.chars().map(|c| match c {
        '-' => '+',
        '_' => '/',
        other => other,
    }).collect();
    // Add padding
    while std_b64.len() % 4 != 0 {
        std_b64.push('=');
    }
    base64_decode_standard(&std_b64)
}

fn base64_decode_standard(input: &str) -> Option<Vec<u8>> {
    const DECODE: [i8; 128] = {
        let mut table = [-1i8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            table[chars[i] as usize] = i as i8;
            i += 1;
        }
        table
    };

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=').collect();
    let mut result = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = *DECODE.get(bytes[i] as usize)? as u32;
        let b1 = if i + 1 < bytes.len() { *DECODE.get(bytes[i + 1] as usize)? as u32 } else { 0 };
        let b2 = if i + 2 < bytes.len() { *DECODE.get(bytes[i + 2] as usize)? as u32 } else { 0 };
        let b3 = if i + 3 < bytes.len() { *DECODE.get(bytes[i + 3] as usize)? as u32 } else { 0 };

        let triple = (b0 << 18) | (b1 << 12) | (b2 << 6) | b3;

        result.push((triple >> 16) as u8);
        if i + 2 < bytes.len() {
            result.push((triple >> 8) as u8);
        }
        if i + 3 < bytes.len() {
            result.push(triple as u8);
        }
        i += 4;
    }
    Some(result)
}

// ---------------------------------------------------------------------------
// GitHub / Google OAuth URL builders
// ---------------------------------------------------------------------------

/// Build the GitHub OAuth authorization URL.
pub fn get_github_oauth_url(client_id: &str, base_url: &str, state: Option<&str>) -> String {
    let redirect_uri = format!("{base_url}/api/auth/github/callback");
    let mut params = vec![
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri),
        ("scope", "read:user".to_string()),
    ];
    if let Some(s) = state {
        params.push(("state", s.to_string()));
    }
    let query: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoded(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("https://github.com/login/oauth/authorize?{query}")
}

/// Build the Google OAuth authorization URL.
pub fn get_google_oauth_url(client_id: &str, base_url: &str, state: Option<&str>) -> String {
    let redirect_uri = format!("{base_url}/api/auth/google/callback");
    let mut params = vec![
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code".to_string()),
        ("scope", "openid email profile".to_string()),
    ];
    if let Some(s) = state {
        params.push(("state", s.to_string()));
    }
    let query: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoded(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("https://accounts.google.com/o/oauth2/v2/auth?{query}")
}

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

// ---------------------------------------------------------------------------
// Axum extractor — AuthUser
// ---------------------------------------------------------------------------

/// Authenticated user extracted from the `Authorization: Bearer <token>` header.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
}

impl FromRequestParts<crate::state::AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::state::AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AuthError::MissingAuth)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AuthError::MissingAuth)?;

        let payload = verify_jwt(token, &state.config.jwt_secret)
            .map_err(|_| AuthError::InvalidToken)?;

        Ok(AuthUser {
            user_id: payload.sub,
        })
    }
}

impl FromRequestParts<std::sync::Arc<crate::state::AppState>> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &std::sync::Arc<crate::state::AppState>,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AuthError::MissingAuth)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AuthError::MissingAuth)?;

        let payload = verify_jwt(token, &state.config.jwt_secret)
            .map_err(|_| AuthError::InvalidToken)?;

        Ok(AuthUser {
            user_id: payload.sub,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_roundtrip() {
        let secret = "test-secret-key";
        let token = sign_jwt("user-123", secret);
        let payload = verify_jwt(&token, secret).expect("should verify");
        assert_eq!(payload.sub, "user-123");
        assert!(payload.exp > Utc::now().timestamp());
    }

    #[test]
    fn jwt_bad_secret_fails() {
        let token = sign_jwt("user-123", "secret-a");
        let result = verify_jwt(&token, "secret-b");
        assert!(result.is_err());
    }

    #[test]
    fn password_hash_and_verify() {
        let hash = hash_password("my-password").expect("should hash");
        assert!(verify_password("my-password", &hash));
        assert!(!verify_password("wrong-password", &hash));
    }

    #[test]
    fn token_hash_deterministic() {
        let h1 = hash_token("some-token");
        let h2 = hash_token("some-token");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 hex is 64 chars
    }

    #[test]
    fn registration_token_is_uuid() {
        let token = generate_registration_token();
        assert!(uuid::Uuid::parse_str(&token).is_ok());
    }

    #[test]
    fn oauth_state_roundtrip() {
        let payload = OAuthStatePayload {
            redirect_to: Some("https://example.com/callback".to_string()),
        };
        let encoded = encode_oauth_state(&payload).expect("should encode");
        let decoded = decode_oauth_state(Some(&encoded));
        assert_eq!(
            decoded.redirect_to.as_deref(),
            Some("https://example.com/callback")
        );
    }

    #[test]
    fn oauth_state_none_when_no_redirect() {
        let payload = OAuthStatePayload { redirect_to: None };
        assert!(encode_oauth_state(&payload).is_none());
    }

    #[test]
    fn decode_oauth_state_graceful_on_garbage() {
        let decoded = decode_oauth_state(Some("not-valid-base64!!!"));
        assert!(decoded.redirect_to.is_none());
    }

    #[test]
    fn append_token_to_url_without_query() {
        let result = append_auth_token_to_redirect_target("https://example.com", "abc");
        assert_eq!(result, "https://example.com?token=abc");
    }

    #[test]
    fn append_token_to_url_with_query() {
        let result = append_auth_token_to_redirect_target("https://example.com?foo=bar", "abc");
        assert_eq!(result, "https://example.com?foo=bar&token=abc");
    }

    #[test]
    fn github_oauth_url_without_state() {
        let url = get_github_oauth_url("my-client-id", "https://app.example.com", None);
        assert!(url.starts_with("https://github.com/login/oauth/authorize?"));
        assert!(url.contains("client_id=my-client-id"));
        assert!(url.contains("scope=read%3Auser"));
        assert!(!url.contains("state="));
    }

    #[test]
    fn github_oauth_url_with_state() {
        let url = get_github_oauth_url("cid", "https://app.example.com", Some("xyz"));
        assert!(url.contains("state=xyz"));
    }

    #[test]
    fn google_oauth_url_without_state() {
        let url = get_google_oauth_url("my-client-id", "https://app.example.com", None);
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("client_id=my-client-id"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("scope=openid%20email%20profile"));
        assert!(!url.contains("state="));
    }
}
