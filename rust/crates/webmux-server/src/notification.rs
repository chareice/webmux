use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use tokio::sync::RwLock;
use tracing::{error, warn};

use crate::db::notifications::{delete_notification_device, find_notification_devices_by_user_id};
use crate::db::types::NotificationDeviceRow;
use crate::db::DbPool;

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const FCM_CHANNEL_ID: &str = "thread_updates";

/// Firebase service account credentials parsed from the base64-encoded JSON.
#[derive(Debug, Clone)]
pub struct FirebaseServiceAccount {
    pub project_id: String,
    pub client_email: String,
    pub private_key: String,
}

/// Information about a turn completion, used to build notifications.
#[derive(Debug, Clone)]
pub struct TurnCompletionNotification {
    pub user_id: String,
    pub agent_id: String,
    pub run_id: String,
    pub turn_id: String,
    pub turn_index: i64,
    pub status: String,
    pub summary: Option<String>,
    pub tool: String,
    pub repo_path: String,
}

/// Cached OAuth2 access token.
struct CachedAccessToken {
    token: String,
    expires_at: u64,
}

/// FCM push notification service.
pub struct NotificationService {
    db: DbPool,
    service_account: FirebaseServiceAccount,
    cached_token: Arc<RwLock<Option<CachedAccessToken>>>,
    http_client: reqwest::Client,
}

/// Parse base64-encoded Firebase service account JSON into credentials.
pub fn parse_firebase_service_account(
    base64_value: Option<&str>,
) -> Option<FirebaseServiceAccount> {
    let value = base64_value?.trim();
    if value.is_empty() {
        return None;
    }

    let decoded = base64_decode(value)?;
    let json_str = String::from_utf8(decoded).ok()?;

    #[derive(Deserialize)]
    struct RawServiceAccount {
        project_id: Option<String>,
        client_email: Option<String>,
        private_key: Option<String>,
    }

    let parsed: RawServiceAccount = serde_json::from_str(&json_str).ok()?;

    let project_id = parsed.project_id?;
    let client_email = parsed.client_email?;
    let private_key = parsed.private_key?;

    if project_id.is_empty() || client_email.is_empty() || private_key.is_empty() {
        return None;
    }

    Some(FirebaseServiceAccount {
        project_id,
        client_email,
        private_key: private_key.replace("\\n", "\n"),
    })
}

/// Create a notification service if Firebase credentials are configured.
pub fn create_notification_service(
    db: DbPool,
    firebase_base64: Option<&str>,
) -> Option<NotificationService> {
    let service_account = parse_firebase_service_account(firebase_base64)?;
    Some(NotificationService {
        db,
        service_account,
        cached_token: Arc::new(RwLock::new(None)),
        http_client: reqwest::Client::new(),
    })
}

impl NotificationService {
    /// Send push notifications for a completed turn to all of the user's registered devices.
    pub async fn notify_turn_completed(&self, notification: &TurnCompletionNotification) {
        let devices = {
            let conn = match self.db.get() {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to get DB connection for notifications: {}", e);
                    return;
                }
            };
            match find_notification_devices_by_user_id(&conn, &notification.user_id) {
                Ok(d) => d,
                Err(e) => {
                    error!("Failed to fetch notification devices: {}", e);
                    return;
                }
            }
        };

        for device in &devices {
            let result = self.send_turn_completion(device, notification).await;
            if result.remove_device {
                let conn = match self.db.get() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let _ = delete_notification_device(
                    &conn,
                    &notification.user_id,
                    &device.installation_id,
                );
            }
        }
    }

    async fn send_turn_completion(
        &self,
        device: &NotificationDeviceRow,
        notification: &TurnCompletionNotification,
    ) -> SendResult {
        let access_token = match self.get_access_token().await {
            Ok(t) => t,
            Err(e) => {
                error!("Failed to get FCM access token: {}", e);
                return SendResult {
                    ok: false,
                    remove_device: false,
                };
            }
        };

        let (title, body) = build_notification_copy(notification);
        let data = build_notification_data(notification);

        let fcm_url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.service_account.project_id
        );

        let payload = serde_json::json!({
            "message": {
                "token": device.push_token,
                "notification": {
                    "title": title,
                    "body": body,
                },
                "data": data,
                "android": {
                    "priority": "high",
                    "notification": {
                        "channel_id": FCM_CHANNEL_ID,
                        "tag": notification.run_id,
                    }
                }
            }
        });

        let response = self
            .http_client
            .post(&fcm_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => SendResult {
                ok: true,
                remove_device: false,
            },
            Ok(resp) => {
                let body_text = resp.text().await.unwrap_or_default();
                let remove = should_remove_device_from_fcm_response(&body_text);
                if remove {
                    warn!("FCM device unregistered, removing: {}", device.installation_id);
                }
                SendResult {
                    ok: false,
                    remove_device: remove,
                }
            }
            Err(e) => {
                error!("FCM request failed: {}", e);
                SendResult {
                    ok: false,
                    remove_device: false,
                }
            }
        }
    }

    async fn get_access_token(&self) -> Result<String, String> {
        // Check cached token
        {
            let cached = self.cached_token.read().await;
            if let Some(ref token) = *cached {
                let now_ms = now_millis();
                if token.expires_at > now_ms + 60_000 {
                    return Ok(token.token.clone());
                }
            }
        }

        // Create JWT assertion
        let now_secs = (now_millis() / 1000) as i64;
        let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        let claims = serde_json::json!({
            "iss": self.service_account.client_email,
            "sub": self.service_account.client_email,
            "aud": OAUTH_TOKEN_URL,
            "scope": FCM_SCOPE,
            "iat": now_secs,
            "exp": now_secs + 3600,
        });

        let key = jsonwebtoken::EncodingKey::from_rsa_pem(
            self.service_account.private_key.as_bytes(),
        )
        .map_err(|e| format!("Invalid RSA key: {}", e))?;

        let assertion = jsonwebtoken::encode(&header, &claims, &key)
            .map_err(|e| format!("JWT encode error: {}", e))?;

        // Exchange for access token
        let resp = self
            .http_client
            .post(OAUTH_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ),
                ("assertion", &assertion),
            ])
            .send()
            .await
            .map_err(|e| format!("Token request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to fetch Firebase access token: {}",
                text
            ));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: Option<String>,
            expires_in: Option<u64>,
        }

        let body: TokenResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        let access_token = body
            .access_token
            .ok_or("Token response missing access_token")?;
        let expires_in = body.expires_in.ok_or("Token response missing expires_in")?;

        // Cache the token
        {
            let mut cached = self.cached_token.write().await;
            *cached = Some(CachedAccessToken {
                token: access_token.clone(),
                expires_at: now_millis() + expires_in * 1000,
            });
        }

        Ok(access_token)
    }
}

struct SendResult {
    #[allow(dead_code)]
    ok: bool,
    remove_device: bool,
}

fn build_notification_copy(notification: &TurnCompletionNotification) -> (String, String) {
    let repo_name = Path::new(&notification.repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&notification.repo_path);

    let tool_label = if notification.tool == "codex" {
        "Codex"
    } else {
        "Claude"
    };

    if notification.status == "success" {
        let body = truncate_notification_text(notification.summary.as_deref()).unwrap_or_else(|| {
            format!(
                "{} turn {} finished successfully.",
                tool_label, notification.turn_index
            )
        });
        (format!("{} completed", repo_name), body)
    } else {
        let body = truncate_notification_text(notification.summary.as_deref()).unwrap_or_else(|| {
            format!(
                "{} turn {} finished with status {}.",
                tool_label, notification.turn_index, notification.status
            )
        });
        (format!("{} needs attention", repo_name), body)
    }
}

fn build_notification_data(
    notification: &TurnCompletionNotification,
) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    map.insert(
        "type".to_string(),
        serde_json::Value::String("thread-completed".to_string()),
    );
    map.insert(
        "agentId".to_string(),
        serde_json::Value::String(notification.agent_id.clone()),
    );
    map.insert(
        "runId".to_string(),
        serde_json::Value::String(notification.run_id.clone()),
    );
    map.insert(
        "turnId".to_string(),
        serde_json::Value::String(notification.turn_id.clone()),
    );
    map.insert(
        "status".to_string(),
        serde_json::Value::String(notification.status.clone()),
    );
    map.insert(
        "turnIndex".to_string(),
        serde_json::Value::String(notification.turn_index.to_string()),
    );
    map
}

fn truncate_notification_text(text: Option<&str>) -> Option<String> {
    let text = text?;
    if text.is_empty() {
        return None;
    }
    // Collapse whitespace
    let compact: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= 140 {
        Some(compact)
    } else {
        Some(format!("{}...", &compact[..137]))
    }
}

fn should_remove_device_from_fcm_response(body_text: &str) -> bool {
    body_text.contains("UNREGISTERED")
        || body_text.contains("registration-token-not-registered")
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Simple base64 decoder (standard alphabet).
fn base64_decode(input: &str) -> Option<Vec<u8>> {
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

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut result = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = *DECODE.get(bytes[i] as usize)? as u32;
        let b1 = if i + 1 < bytes.len() {
            *DECODE.get(bytes[i + 1] as usize)? as u32
        } else {
            0
        };
        let b2 = if i + 2 < bytes.len() {
            *DECODE.get(bytes[i + 2] as usize)? as u32
        } else {
            0
        };
        let b3 = if i + 3 < bytes.len() {
            *DECODE.get(bytes[i + 3] as usize)? as u32
        } else {
            0
        };

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
