use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
struct CreateBookmarkRequest {
    path: String,
    label: String,
}

#[derive(Serialize)]
struct BookmarkResponse {
    id: String,
    machine_id: String,
    path: String,
    label: String,
    sort_order: i64,
    created_at: i64,
}

async fn list_bookmarks(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
) -> Result<Json<Vec<BookmarkResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let bookmarks =
        db::bookmarks::find_bookmarks_by_machine(&conn, &auth_user.user_id, &machine_id).map_err(
            |e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": format!("DB error: {e}")})),
                )
            },
        )?;

    let response: Vec<BookmarkResponse> = bookmarks
        .into_iter()
        .map(|b| BookmarkResponse {
            id: b.id,
            machine_id: b.machine_id,
            path: b.path,
            label: b.label,
            sort_order: b.sort_order,
            created_at: b.created_at,
        })
        .collect();

    Ok(Json(response))
}

async fn create_bookmark(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<CreateBookmarkRequest>,
) -> Result<Json<BookmarkResponse>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let bookmark = db::bookmarks::create_bookmark(
        &conn,
        &id,
        &auth_user.user_id,
        &machine_id,
        &req.path,
        &req.label,
        0,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    Ok(Json(BookmarkResponse {
        id: bookmark.id,
        machine_id: bookmark.machine_id,
        path: bookmark.path,
        label: bookmark.label,
        sort_order: bookmark.sort_order,
        created_at: bookmark.created_at,
    }))
}

async fn delete_bookmark(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(bookmark_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    db::bookmarks::delete_bookmark(&conn, &bookmark_id, &auth_user.user_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/machines/{machine_id}/bookmarks",
            get(list_bookmarks).post(create_bookmark),
        )
        .route("/api/bookmarks/{bookmark_id}", delete(delete_bookmark))
}
