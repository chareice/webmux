use std::collections::HashMap;

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::db;
use crate::AppState;

#[derive(Serialize)]
struct SettingsResponse {
    settings: HashMap<String, String>,
}

#[derive(Deserialize)]
struct UpdateSettingsRequest {
    settings: HashMap<String, String>,
}

async fn get_settings(
    State(state): State<AppState>,
    _auth_user: AuthUser,
) -> Result<Json<SettingsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let pairs = db::settings::get_all_settings(&conn).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let settings: HashMap<String, String> = pairs.into_iter().collect();

    Ok(Json(SettingsResponse { settings }))
}

async fn update_settings(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<Json<SettingsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    // Upsert each setting; delete if value is empty string
    for (key, value) in &req.settings {
        if value.is_empty() {
            db::settings::delete_setting(&conn, key).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": format!("DB error: {e}")})),
                )
            })?;
        } else {
            db::settings::set_setting(&conn, key, value).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": format!("DB error: {e}")})),
                )
            })?;
        }
    }

    // Return the updated full settings
    let pairs = db::settings::get_all_settings(&conn).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("DB error: {e}")})),
        )
    })?;

    let settings: HashMap<String, String> = pairs.into_iter().collect();

    Ok(Json(SettingsResponse { settings }))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/settings", get(get_settings).put(update_settings))
}
