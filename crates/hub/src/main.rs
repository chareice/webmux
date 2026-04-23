mod attach_router;
mod auth;
pub mod db;
mod machine_manager;
mod routes;
mod ws;

use clap::Parser;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::attach_router::HubRouter;
use crate::db::DbPool;
use crate::machine_manager::MachineManager;

#[derive(Parser)]
#[command(name = "webmux-server", about = "webmux hub server")]
struct Args {
    /// Listen address
    #[arg(long, default_value = "0.0.0.0:4317")]
    listen: String,

    /// Path to frontend static files
    #[arg(long, default_value = "packages/app/dist", env = "WEBMUX_STATIC_DIR")]
    static_dir: String,

    /// Path to SQLite database file
    #[arg(long, default_value = "./webmux.db", env = "DATABASE_PATH")]
    database: String,
}

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<MachineManager>,
    pub router: Arc<HubRouter>,
    pub db: DbPool,
    pub jwt_secret: String,
    pub base_url: String,
    pub dev_mode: bool,
    pub native_zellij_allow_insecure_tls: bool,
    pub native_zellij_ca_cert_pem: Option<Arc<Vec<u8>>>,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}

fn env_flag(key: &str) -> bool {
    matches!(
        env_opt(key).as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn read_optional_bytes(key: &str) -> Option<Arc<Vec<u8>>> {
    let path = env_opt(key)?;
    let bytes = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("Failed to read {key} from {path}: {error}"));
    Some(Arc::new(bytes))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    // Initialize database
    let pool = db::create_pool(&args.database).expect("Failed to create database pool");
    {
        let conn = pool.get().expect("Failed to get database connection");
        db::init_db(&conn).expect("Failed to initialize database");
    }
    tracing::info!("Database initialized at {}", args.database);

    let state = AppState {
        manager: Arc::new(MachineManager::new(pool.clone())),
        router: Arc::new(HubRouter::new()),
        db: pool,
        jwt_secret: env_or("JWT_SECRET", "dev-secret-change-me"),
        base_url: env_or("WEBMUX_BASE_URL", "http://localhost:4317"),
        dev_mode: env_or("WEBMUX_DEV_MODE", "false") == "true",
        native_zellij_allow_insecure_tls: env_flag("WEBMUX_ZELLIJ_ALLOW_INSECURE_TLS"),
        native_zellij_ca_cert_pem: read_optional_bytes("WEBMUX_ZELLIJ_CA_CERT"),
        github_client_id: env_opt("GITHUB_CLIENT_ID"),
        github_client_secret: env_opt("GITHUB_CLIENT_SECRET"),
        google_client_id: env_opt("GOOGLE_CLIENT_ID"),
        google_client_secret: env_opt("GOOGLE_CLIENT_SECRET"),
    };

    state.manager.start_seq_flush_task();

    let app = routes::router()
        .merge(ws::router())
        .layer(CorsLayer::permissive())
        .fallback_service(
            ServeDir::new(&args.static_dir)
                .not_found_service(ServeFile::new(format!("{}/index.html", args.static_dir))),
        )
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap();

    tracing::info!("Hub running on http://{}", args.listen);
    axum::serve(listener, app).await.unwrap();
}
