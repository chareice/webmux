pub mod actions;
pub mod agents;
pub mod api_tokens;
pub mod auth;
pub mod llm_configs;
pub mod mobile;
pub mod projects;
pub mod qr_login;
pub mod tasks;
pub mod threads;

use std::sync::Arc;

use axum::Router;

use crate::state::AppState;

/// Create the main axum router with all REST API routes.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/api", api_routes())
        .with_state(state)
}

fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(auth::routes())
        .merge(agents::routes())
        .merge(api_tokens::routes())
        .merge(threads::routes())
        .merge(projects::routes())
        .merge(tasks::routes())
        .merge(llm_configs::routes())
        .merge(mobile::routes())
        .merge(actions::routes())
        .merge(qr_login::routes())
}
