mod attach_router;
mod auth;
mod first_run;
#[cfg(feature = "embed-ui")]
mod embedded_ui;
pub mod db;
mod machine_manager;
mod routes;
mod ws;

use axum::body::Body;
use axum::http::{header, HeaderValue};
use axum::{http::StatusCode, response::IntoResponse, routing::any, Router};
use clap::{Parser, Subcommand};
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
#[command(name = "offdesk-hub", about = "offdesk hub server", version)]
struct Args {
    #[command(subcommand)]
    command: Option<Command>,

    /// Listen address
    #[arg(long, default_value = "0.0.0.0:4317", global = true)]
    listen: String,

    /// Let the machine idle-sleep while the hub runs. By default the hub
    /// keeps its host awake (macOS), because a hub whose host is asleep is a
    /// hub that is down.
    #[arg(long, env = "OFFDESK_ALLOW_IDLE_SLEEP", global = true)]
    allow_idle_sleep: bool,

    /// Print the sign-in link without opening it in a browser. It is only
    /// opened when a person is at this terminal anyway — never as a service,
    /// never over SSH.
    #[arg(long, env = "OFFDESK_NO_OPEN", global = true)]
    no_open: bool,

    /// Path to frontend static files. Without it the binary serves the UI it
    /// was built with, and falls back to ./packages/app/dist when it has none.
    #[arg(long, env = "OFFDESK_STATIC_DIR")]
    static_dir: Option<String>,

    /// Path to the SQLite database. Defaults to the offdesk config directory
    /// (~/Library/Application Support/offdesk on macOS, ~/.config/offdesk on
    /// Linux); the signing key is kept beside it.
    #[arg(long, env = "DATABASE_PATH")]
    database: Option<String>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the hub at login, restarted if it stops — a launchd agent on macOS,
    /// a systemd user service on Linux
    Service {
        #[command(subcommand)]
        action: ServiceCommand,
    },
}

#[derive(Subcommand, Clone, Copy)]
enum ServiceCommand {
    /// Install and start the service, with the arguments given to this command
    Install,
    /// Stop and remove the service
    Uninstall,
    /// Restart the running service, to pick up a new binary
    Restart,
    /// Show service status
    Status,
}

/// The hub as launchd/systemd sees it. Whatever --listen the person installed
/// with is baked into the unit, so `service install --listen 0.0.0.0:8080`
/// means what it looks like.
fn service_spec(listen: &str, allow_idle_sleep: bool) -> offdesk_protocol::service::ServiceSpec {
    let mut args = vec!["--listen".to_string(), listen.to_string()];
    if allow_idle_sleep {
        args.push("--allow-idle-sleep".to_string());
    }
    offdesk_protocol::service::ServiceSpec {
        name: "offdesk-hub",
        label: "dev.offdesk.hub",
        description: "offdesk hub".to_string(),
        args,
    }
}

fn run_service(action: ServiceCommand, args: &Args) {
    use offdesk_protocol::service as svc;
    let listen = &args.listen;
    let spec = service_spec(listen, args.allow_idle_sleep);
    let outcome = match action {
        ServiceCommand::Install => svc::install(&spec).and_then(|()| {
            // Installing is the whole first step now: the hub is up, this
            // machine is registered to it, and the link is on the terminal
            // — nothing to read out of a log file, nothing to Ctrl-C.
            if !first_run::wait_for_hub(listen, std::time::Duration::from_secs(20)) {
                return Err(format!(
                    "the service was installed but nothing answered on {listen} within 20s; \
                     see offdesk-hub service status"
                ));
            }
            let database = first_run::database_path(args.database.as_deref());
            let Some(jwt_secret) = first_run::stored_jwt_secret(&database) else {
                println!("offdesk-hub is installed as a service and running.");
                println!("Its sign-in link is in the log: offdesk-hub service status");
                return Ok(());
            };
            let pool = db::create_pool(&database).map_err(|e| e.to_string())?;
            let local = first_run::register_local_node(&pool, listen);
            let base_url = env_or("OFFDESK_BASE_URL", "http://localhost:4317");
            match first_run::service_notice(&pool, &jwt_secret, &base_url, listen, &database, &local) {
                Some(notice) => {
                    println!("{notice}");
                    if first_run::should_open_browser(args.no_open) {
                        if let Some(link) = first_run::sign_in_link(&pool, &jwt_secret, &base_url, listen) {
                            println!("  Opening it in your browser.\n");
                            first_run::open_in_browser(&link);
                        }
                    }
                }
                None => {
                    println!("offdesk-hub is installed as a service and running: {}", first_run::reachable_base_url(&base_url, listen));
                }
            }
            Ok(())
        }),
        ServiceCommand::Uninstall => svc::uninstall(&spec).map(|()| {
            println!("offdesk-hub service removed.");
        }),
        ServiceCommand::Restart => svc::restart(&spec).map(|()| {
            println!("offdesk-hub service restarted.");
        }),
        ServiceCommand::Status => {
            svc::status(&spec);
            return;
        }
    };
    if let Err(error) = outcome {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
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

/// Pre-rename environment variables still work. Promote each one into its
/// offdesk name before anything reads the environment, so both clap's
/// `env =` attributes and `env_or` below see it. Dropped once nobody is on
/// webmux.
fn promote_legacy_env() {
    for suffix in ["STATIC_DIR", "BASE_URL", "DEV_MODE"] {
        let new = format!("OFFDESK_{suffix}");
        let old = format!("WEBMUX_{suffix}");
        if std::env::var_os(&new).is_none() {
            if let Some(value) = std::env::var_os(&old) {
                eprintln!("warning: {old} is deprecated, use {new}");
                std::env::set_var(&new, value);
            }
        }
    }
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

    promote_legacy_env();
    let args = Args::parse();

    if let Some(Command::Service { action }) = &args.command {
        run_service(*action, &args);
        return;
    }

    // Held for the life of main: the machine does not idle-sleep while the
    // hub is up. `_` alone would drop it immediately.
    let _keep_awake = if args.allow_idle_sleep {
        None
    } else {
        match offdesk_protocol::keep_awake::prevent_idle_sleep() {
            Ok((guard, offdesk_protocol::keep_awake::KeepAwake::Held)) => {
                tracing::info!("keeping this machine awake while the hub runs (--allow-idle-sleep to opt out)");
                guard
            }
            Ok((guard, offdesk_protocol::keep_awake::KeepAwake::Unsupported)) => guard,
            Err(error) => {
                tracing::warn!("could not keep the machine awake: {error}");
                None
            }
        }
    };

    let database = first_run::database_path(args.database.as_deref());

    // A hub with no configured key generates one and keeps it next to the
    // database, so sessions survive a restart instead of logging everyone out.
    let (jwt_secret, generated_secret) = first_run::jwt_secret(&database);
    if generated_secret {
        tracing::info!("no JWT_SECRET configured; using a generated one");
    }

    // Initialize database
    let pool = db::create_pool(&database).expect("Failed to create database pool");
    {
        let conn = pool.get().expect("Failed to get database connection");
        db::init_db(&conn).expect("Failed to initialize database");
    }
    tracing::info!("Database initialized at {database}");

    let state = AppState {
        manager: Arc::new(MachineManager::new(pool.clone())),
        router: Arc::new(HubRouter::new()),
        db: pool,
        jwt_secret: jwt_secret.clone(),
        base_url: env_or("OFFDESK_BASE_URL", "http://localhost:4317"),
        dev_mode: env_or("OFFDESK_DEV_MODE", "false") == "true",
        github_client_id: env_opt("GITHUB_CLIENT_ID"),
        github_client_secret: env_opt("GITHUB_CLIENT_SECRET"),
        google_client_id: env_opt("GOOGLE_CLIENT_ID"),
        google_client_secret: env_opt("GOOGLE_CLIENT_SECRET"),
    };

    let pool_for_notice = state.db.clone();
    let base_url_for_notice = state.base_url.clone();
    let has_oauth = state.github_client_id.is_some() || state.google_client_id.is_some();
    let dev_mode = state.dev_mode;

    state.manager.start_seq_flush_task();

    let app = routes::router()
        .merge(ws::router())
        .route("/api", any(api_not_found))
        .route("/api/{*path}", any(api_not_found))
        .layer(CorsLayer::permissive())
        .fallback_service(ui_service(args.static_dir.as_deref()))
        .with_state(state);

    let listener = match tokio::net::TcpListener::bind(&args.listen).await {
        Ok(listener) => listener,
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            eprintln!(
                "error: {} is already in use — another offdesk-hub, probably. \
                 Stop it, or pick a port with --listen 0.0.0.0:<port>.",
                args.listen
            );
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("error: could not listen on {}: {error}", args.listen);
            std::process::exit(1);
        }
    };

    tracing::info!("Hub running on http://{}", args.listen);

    // Printed rather than logged: this is the one thing the person who just
    // started a hub needs, and it should not be buried in a log line.
    if let Some(notice) = first_run::sign_in_notice(
        &pool_for_notice,
        &jwt_secret,
        &base_url_for_notice,
        &args.listen,
        &database,
        has_oauth,
        dev_mode,
    ) {
        println!("{notice}");

        // The link is the whole first step, and the person is right here.
        if first_run::should_open_browser(args.no_open) {
            if let Some(link) = first_run::sign_in_link(
                &pool_for_notice,
                &jwt_secret,
                &base_url_for_notice,
                &args.listen,
            ) {
                println!("  Opening it in your browser.\n");
                first_run::open_in_browser(&link);
            }
        }
    }

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

/// An explicit `--static-dir` always wins: it is how someone runs a hub
/// against a frontend they are editing. Otherwise the baked-in UI, and
/// otherwise the repo-relative path this has always defaulted to.
fn ui_service(static_dir: Option<&str>) -> Router {
    if let Some(dir) = static_dir {
        tracing::info!("serving the web UI from {dir}");
        return static_file_service(dir);
    }

    #[cfg(feature = "embed-ui")]
    if embedded_ui::is_populated() {
        tracing::info!("serving the web UI baked into this binary");
        return Router::new().fallback(embedded_ui::serve);
    }

    tracing::info!("serving the web UI from packages/app/dist");
    static_file_service("packages/app/dist")
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
        let dir = std::env::temp_dir().join(format!("offdesk-hub-static-{unique}"));
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
