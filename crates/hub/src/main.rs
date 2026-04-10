mod auth;
pub mod db;
mod machine_manager;
mod routes;
mod ws;

use std::sync::Arc;
use clap::Parser;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

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
    pub db: DbPool,
    pub jwt_secret: String,
    pub base_url: String,
    pub dev_mode: bool,
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
        manager: Arc::new(MachineManager::new()),
        db: pool,
        jwt_secret: env_or("JWT_SECRET", "dev-secret-change-me"),
        base_url: env_or("WEBMUX_BASE_URL", "http://localhost:4317"),
        dev_mode: env_or("WEBMUX_DEV_MODE", "false") == "true",
        github_client_id: env_opt("GITHUB_CLIENT_ID"),
        github_client_secret: env_opt("GITHUB_CLIENT_SECRET"),
        google_client_id: env_opt("GOOGLE_CLIENT_ID"),
        google_client_secret: env_opt("GOOGLE_CLIENT_SECRET"),
    };

    let app = routes::router()
        .merge(ws::router())
        .layer(CorsLayer::permissive())
        .fallback_service(
            ServeDir::new(&args.static_dir)
                .not_found_service(ServeFile::new(format!("{}/index.html", args.static_dir)))
        )
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.listen)
        .await
        .unwrap();

    tracing::info!("Hub running on http://{}", args.listen);
    axum::serve(listener, app).await.unwrap();
}
