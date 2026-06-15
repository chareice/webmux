mod attach_router;
mod auth;
pub mod db;
mod machine_manager;
mod routes;
mod ws;

use axum::http::{header, HeaderValue};
use axum::{http::StatusCode, routing::any};
use clap::Parser;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

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
        manager: Arc::new(MachineManager::new(pool.clone())),
        router: Arc::new(HubRouter::new()),
        db: pool,
        jwt_secret: env_or("JWT_SECRET", "dev-secret-change-me"),
        base_url: env_or("WEBMUX_BASE_URL", "http://localhost:4317"),
        dev_mode: env_or("WEBMUX_DEV_MODE", "false") == "true",
        github_client_id: env_opt("GITHUB_CLIENT_ID"),
        github_client_secret: env_opt("GITHUB_CLIENT_SECRET"),
        google_client_id: env_opt("GOOGLE_CLIENT_ID"),
        google_client_secret: env_opt("GOOGLE_CLIENT_SECRET"),
    };

    state.manager.start_seq_flush_task();

    let app = routes::router()
        .merge(ws::router())
        .route("/api", any(api_not_found))
        .route("/api/{*path}", any(api_not_found))
        .layer(CorsLayer::permissive())
        .fallback_service(
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::CACHE_CONTROL,
                    cache_control_for_static,
                ))
                .service(
                    ServeDir::new(&args.static_dir)
                        .fallback(ServeFile::new(format!("{}/index.html", args.static_dir))),
                ),
        )
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap();

    tracing::info!("Hub running on http://{}", args.listen);
    axum::serve(listener, app).await.unwrap();
}

fn cache_control_for_static<B>(res: &http::Response<B>) -> Option<HeaderValue> {
    let content_type = res.headers().get(header::CONTENT_TYPE)?.to_str().ok()?;
    let directive = if content_type.starts_with("text/html") {
        // HTML entry point must always be fresh so clients pick up new hashed assets.
        "no-cache, no-store, must-revalidate"
    } else if content_type.starts_with("application/javascript")
        || content_type.starts_with("text/javascript")
        || content_type.starts_with("text/css")
    {
        // Hashed assets never change; cache forever.
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    };
    HeaderValue::from_str(directive).ok()
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}
