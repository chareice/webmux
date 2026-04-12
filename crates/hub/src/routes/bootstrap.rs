use axum::{extract::State, response::Json, routing::get, Router};
use tc_protocol::BrowserStateSnapshot;

use crate::{auth::AuthUser, AppState};

async fn get_bootstrap(
    auth_user: AuthUser,
    State(state): State<AppState>,
) -> Json<BrowserStateSnapshot> {
    Json(state.manager.snapshot_for_user(&auth_user.user_id).await)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/bootstrap", get(get_bootstrap))
}
