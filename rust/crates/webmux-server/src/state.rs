use std::sync::Arc;
use tokio::sync::RwLock;

use crate::db::DbPool;
use crate::mobile_version::MobileVersionResolver;
use crate::qr_hub::QrSessionHub;
use crate::ws::agent_hub::AgentHub;

/// Shared application state, passed to all handlers via axum's State extractor.
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub hub: Arc<RwLock<AgentHub>>,
    pub qr_hub: Arc<RwLock<QrSessionHub>>,
    pub config: Arc<ServerConfig>,
    pub mobile_version_resolver: Arc<MobileVersionResolver>,
}

/// Server configuration loaded from environment variables at startup.
pub struct ServerConfig {
    pub jwt_secret: String,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub base_url: Option<String>,
    pub dev_mode: bool,
    pub agent_package_name: Option<String>,
    pub agent_target_version: Option<String>,
    pub agent_min_version: Option<String>,
    pub mobile_latest_version: Option<String>,
    pub mobile_download_url: Option<String>,
    pub mobile_min_version: Option<String>,
    pub firebase_service_account_base64: Option<String>,
}
