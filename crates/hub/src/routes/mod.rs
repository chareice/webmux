mod api_tokens;
mod auth;
mod bookmarks;
mod bootstrap;
mod mode;
mod native_zellij;
mod registration;
mod settings;
mod terminals;

use axum::Router;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(terminals::router())
        .merge(bootstrap::router())
        .merge(registration::router())
        .merge(bookmarks::router())
        .merge(api_tokens::router())
        .merge(mode::router())
        .merge(native_zellij::router())
        .merge(settings::router())
}
