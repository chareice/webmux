use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use webmux_shared::{CreateLlmConfigRequest, LlmConfig, UpdateLlmConfigRequest};

use crate::auth::AuthUser;
use crate::db::llm_configs::{
    create_llm_config, delete_llm_config, find_llm_config_by_id, find_llm_configs_by_user,
    update_llm_config, CreateLlmConfigData, UpdateLlmConfigData,
};
use crate::db::types::LlmConfigRow;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Row-to-shared-type helper
// ---------------------------------------------------------------------------

fn llm_config_row_to_config(row: &LlmConfigRow) -> LlmConfig {
    LlmConfig {
        id: row.id.clone(),
        api_base_url: row.api_base_url.clone(),
        api_key: row.api_key.clone(),
        model: row.model.clone(),
        project_id: row.project_id.clone(),
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
    }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/llm-configs", get(list_llm_configs))
        .route("/llm-configs", post(create_llm_config_handler))
        .route("/llm-configs/{id}", patch(update_llm_config_handler))
        .route("/llm-configs/{id}", delete(delete_llm_config_handler))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/llm-configs
async fn list_llm_configs(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let rows = find_llm_configs_by_user(&conn, &user_id).map_err(|e| e.to_string())?;
        let configs: Vec<LlmConfig> = rows.iter().map(llm_config_row_to_config).collect();
        Ok::<_, String>(configs)
    })
    .await;

    match result {
        Ok(Ok(configs)) => {
            (StatusCode::OK, Json(serde_json::json!({ "configs": configs }))).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// POST /api/llm-configs
async fn create_llm_config_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<CreateLlmConfigRequest>,
) -> impl IntoResponse {
    let api_base_url = body.api_base_url.trim().to_string();
    let api_key = body.api_key.trim().to_string();
    let model = body.model.trim().to_string();

    if api_base_url.is_empty() || api_key.is_empty() || model.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing required fields: apiBaseUrl, apiKey, model" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let project_id = body.project_id.as_deref().map(|s| s.trim().to_string());

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let config = create_llm_config(
            &conn,
            &user_id,
            CreateLlmConfigData {
                api_base_url: &api_base_url,
                api_key: &api_key,
                model: &model,
                project_id: project_id.as_deref(),
            },
        )
        .map_err(|e| e.to_string())?;
        Ok::<_, String>(llm_config_row_to_config(&config))
    })
    .await;

    match result {
        Ok(Ok(config)) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "config": config })),
        )
            .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// PATCH /api/llm-configs/:id
async fn update_llm_config_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateLlmConfigRequest>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let api_base_url = body.api_base_url.as_deref().map(|s| s.trim().to_string());
    let api_key = body.api_key.as_deref().map(|s| s.trim().to_string());
    let model = body.model.as_deref().map(|s| s.trim().to_string());

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let config = find_llm_config_by_id(&conn, &id).map_err(|e| e.to_string())?;
        match config {
            None => return Err("not_found".to_string()),
            Some(c) if c.user_id != user_id => return Err("forbidden".to_string()),
            _ => {}
        }

        update_llm_config(
            &conn,
            &id,
            UpdateLlmConfigData {
                api_base_url: api_base_url.as_deref(),
                api_key: api_key.as_deref(),
                model: model.as_deref(),
                project_id: None, // Don't change project_id via this endpoint
            },
        )
        .map_err(|e| e.to_string())?;

        let updated = find_llm_config_by_id(&conn, &id)
            .map_err(|e| e.to_string())?
            .unwrap();
        Ok(llm_config_row_to_config(&updated))
    })
    .await;

    match result {
        Ok(Ok(config)) => {
            (StatusCode::OK, Json(serde_json::json!({ "config": config }))).into_response()
        }
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "LLM config not found" })),
        )
            .into_response(),
        Ok(Err(e)) if e == "forbidden" => (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Not your config" })),
        )
            .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// DELETE /api/llm-configs/:id
async fn delete_llm_config_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let config = find_llm_config_by_id(&conn, &id).map_err(|e| e.to_string())?;
        match config {
            None => return Err("not_found".to_string()),
            Some(c) if c.user_id != user_id => return Err("forbidden".to_string()),
            _ => {}
        }

        delete_llm_config(&conn, &id).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "LLM config not found" })),
        )
            .into_response(),
        Ok(Err(e)) if e == "forbidden" => (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Not your config" })),
        )
            .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}
