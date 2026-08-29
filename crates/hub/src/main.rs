mod attach_router;
mod auth;
pub mod db;
mod machine_manager;
mod routes;
mod ws;

use axum::body::Body;
use axum::http::{header, HeaderValue};
use axum::{http::StatusCode, response::IntoResponse, routing::any, Router};
use clap::Parser;
use std::path::Path;
use std::sync::Arc;
use tower::{service_fn, ServiceBuilder, ServiceExt};
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
        .fallback_service(static_file_service(&args.static_dir))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap();

    tracing::info!("Hub running on http://{}", args.listen);
    // Nagle's algorithm batches small TCP segments while ACKs are outstanding,
    // which turns per-keystroke WS frames into visible latency spikes. axum
    // does not set TCP_NODELAY on accepted connections by default.
    let listener = axum::serve::ListenerExt::tap_io(listener, |io| {
        let _ = io.set_nodelay(true);
    });
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

fn static_file_service(static_dir: impl AsRef<Path>) -> Router {
    let static_dir = static_dir.as_ref();
    let index = ServeFile::new(static_dir.join("index.html"));
    let fallback = service_fn(move |request: http::Request<_>| {
        let index = index.clone();
        async move {
            let path = request.uri().path();
            let looks_like_asset = path.starts_with("/_expo/")
                || path
                    .rsplit('/')
                    .next()
                    .is_some_and(|segment| segment.contains('.'));
            let response = if looks_like_asset {
                StatusCode::NOT_FOUND.into_response()
            } else {
                index
                    .oneshot(request)
                    .await
                    .expect("ServeFile is infallible")
                    .map(Body::new)
            };
            Ok::<_, std::convert::Infallible>(response)
        }
    });

    Router::new().fallback_service(
        ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::if_not_present(
                header::CACHE_CONTROL,
                cache_control_for_static,
            ))
            .service(ServeDir::new(static_dir).fallback(fallback)),
    )
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tower::ServiceExt;

    fn static_fixture() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("webmux-hub-static-{unique}"));
        fs::create_dir_all(&dir).expect("static fixture directory should be created");
        fs::write(dir.join("index.html"), "<html>app shell</html>")
            .expect("index fixture should be written");
        dir
    }

    #[tokio::test]
    async fn missing_expo_asset_returns_real_not_found() {
        let static_dir = static_fixture();

        let response = static_file_service(&static_dir)
            .oneshot(
                Request::builder()
                    .uri("/_expo/static/js/web/x.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_ne!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/html"))
        );

        fs::remove_dir_all(static_dir).expect("static fixture should be removed");
    }

    #[tokio::test]
    async fn missing_extensionless_route_serves_spa_entry_point() {
        let static_dir = static_fixture();

        let response = static_file_service(&static_dir)
            .oneshot(
                Request::builder()
                    .uri("/some/route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/html"))
        );

        fs::remove_dir_all(static_dir).expect("static fixture should be removed");
    }

    #[tokio::test]
    async fn existing_static_asset_ignores_query_and_keeps_cache_headers() {
        let static_dir = static_fixture();
        let asset_dir = static_dir.join("_expo/static/js/web");
        fs::create_dir_all(&asset_dir).expect("asset fixture directory should be created");
        fs::write(asset_dir.join("entry.js"), "console.log('current');")
            .expect("asset fixture should be written");

        let response = static_file_service(&static_dir)
            .oneshot(
                Request::builder()
                    .uri("/_expo/static/js/web/entry.js?v=build-123")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/javascript"))
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL),
            Some(&HeaderValue::from_static(
                "public, max-age=31536000, immutable"
            ))
        );
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], b"console.log('current');");

        fs::remove_dir_all(static_dir).expect("static fixture should be removed");
    }
}
