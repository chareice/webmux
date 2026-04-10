mod api_tokens;
mod auth;
mod bookmarks;
mod registration;
mod terminals;

use axum::Router;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(terminals::router())
        .merge(registration::router())
        .merge(bookmarks::router())
        .merge(api_tokens::router())
}
