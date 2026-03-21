pub mod agent_upgrade;
pub mod auth;
pub mod db;
pub mod error;
pub mod mobile_version;
pub mod notification;
pub mod routes;
pub mod state;
pub mod ws;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

use crate::state::{AppState, ServerConfig};
use crate::ws::agent_hub::AgentHub;
use crate::ws::handlers;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Read environment variables
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4317);
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret".to_string());
    let dev_mode = std::env::var("WEBMUX_DEV_MODE")
        .map(|v| !v.trim().is_empty() && v != "0" && v != "false")
        .unwrap_or(false);
    let database_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "./webmux.db".to_string());
    let static_dir =
        std::env::var("WEBMUX_STATIC_DIR").unwrap_or_else(|_| "./web".to_string());

    let github_client_id = non_empty_env("GITHUB_CLIENT_ID");
    let github_client_secret = non_empty_env("GITHUB_CLIENT_SECRET");
    let google_client_id = non_empty_env("GOOGLE_CLIENT_ID");
    let google_client_secret = non_empty_env("GOOGLE_CLIENT_SECRET");
    let base_url = non_empty_env("WEBMUX_BASE_URL")
        .or_else(|| Some(format!("http://localhost:{}", port)));
    let firebase_base64 = non_empty_env("WEBMUX_FIREBASE_SERVICE_ACCOUNT_BASE64");

    let agent_package_name = non_empty_env("WEBMUX_AGENT_PACKAGE_NAME");
    let agent_target_version = non_empty_env("WEBMUX_AGENT_TARGET_VERSION");
    let agent_min_version = non_empty_env("WEBMUX_AGENT_MIN_VERSION");

    let mobile_latest_version = non_empty_env("WEBMUX_MOBILE_LATEST_VERSION");
    let mobile_download_url = non_empty_env("WEBMUX_MOBILE_DOWNLOAD_URL");
    let mobile_min_version = non_empty_env("WEBMUX_MOBILE_MIN_VERSION");

    // Log warnings
    if dev_mode {
        warn!("=== WARNING: Running in DEV MODE -- authentication is relaxed ===");
    }

    if !dev_mode && (github_client_id.is_none() || github_client_secret.is_none()) {
        warn!("WARNING: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set. GitHub OAuth will fail.");
    }

    if jwt_secret == "dev-secret" && !dev_mode {
        warn!("WARNING: Using default JWT_SECRET. Set JWT_SECRET for production.");
    }

    // Create DB pool and initialize
    let db_pool =
        db::create_pool(&database_path).expect("Failed to create database connection pool");

    {
        let conn = db_pool.get().expect("Failed to get DB connection");
        db::init_db(&conn).expect("Failed to initialize database");
    }

    // Create AgentHub
    let hub = Arc::new(RwLock::new(AgentHub::new()));

    // Build config
    let config = Arc::new(ServerConfig {
        jwt_secret,
        github_client_id,
        github_client_secret,
        google_client_id,
        google_client_secret,
        base_url,
        dev_mode,
        agent_package_name,
        agent_target_version,
        agent_min_version,
        mobile_latest_version,
        mobile_download_url,
        mobile_min_version,
        firebase_service_account_base64: firebase_base64,
    });

    // Build AppState
    let state = Arc::new(AppState {
        db: db_pool,
        hub,
        config,
    });

    // Build router
    let api_router = routes::create_router(state.clone());

    // WebSocket routes need AppState (not Arc<AppState>) since handlers
    // use State<AppState>. We deref-clone inside wrapper handlers.
    let ws_state = (*state).clone();
    let ws_routes = Router::new()
        .route("/ws/agent", axum::routing::get(handlers::ws_agent_handler))
        .route(
            "/ws/thread",
            axum::routing::get(handlers::ws_thread_handler),
        )
        .route(
            "/ws/project",
            axum::routing::get(handlers::ws_project_handler),
        )
        .with_state(ws_state);

    // Static file serving with SPA fallback
    let index_path = format!("{}/index.html", static_dir);
    let serve_dir = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(&index_path));

    let app = Router::new()
        .merge(api_router)
        .merge(ws_routes)
        .fallback_service(serve_dir);

    // Start server
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("Invalid HOST:PORT");

    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    info!("Webmux server listening on {}", addr);
    if dev_mode {
        let base = std::env::var("WEBMUX_BASE_URL")
            .unwrap_or_else(|_| format!("http://localhost:{}", port));
        info!("Dev login: {}/api/auth/dev", base);
    }

    axum::serve(listener, app.into_make_service())
        .await
        .expect("Server failed");
}

/// Return Some(value) if the env var is set and non-empty, else None.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
}
