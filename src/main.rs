mod api;
mod pty;
mod ws;

use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = Arc::new(pty::PtyManager::new());

    let app = api::router()
        .merge(ws::router())
        .layer(CorsLayer::permissive())
        .fallback_service(ServeDir::new("client/dist"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    tracing::info!("Server running on http://localhost:3000");
    axum::serve(listener, app).await.unwrap();
}
