use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::pty::{PtyManager, TerminalInfo};

pub type AppState = Arc<PtyManager>;

#[derive(Deserialize)]
pub struct CreateTerminalRequest {
    pub cwd: String,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

#[derive(Deserialize)]
pub struct ResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

async fn list_terminals(State(state): State<AppState>) -> Json<Vec<TerminalInfo>> {
    Json(state.list_terminals())
}

async fn create_terminal(
    State(state): State<AppState>,
    Json(req): Json<CreateTerminalRequest>,
) -> Result<Json<TerminalInfo>, (StatusCode, String)> {
    state
        .create_terminal(&req.cwd, req.cols, req.rows)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn destroy_terminal(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .destroy_terminal(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

async fn resize_terminal(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ResizeRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .resize_terminal(&id, req.cols, req.rows)
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

#[derive(Deserialize)]
pub struct InputRequest {
    pub data: String,
}

async fn write_input(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<InputRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .write_to_terminal(&id, req.data.as_bytes())
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

async fn read_screen(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let lines = params
        .get("lines")
        .and_then(|s| s.parse::<usize>().ok());
    state
        .read_screen(&id, lines)
        .map(Json)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

async fn list_directory(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, String)> {
    let path = params.get("path").map(|s| s.as_str()).unwrap_or(".");
    read_directory(path).map(Json).map_err(|e| (StatusCode::BAD_REQUEST, e))
}

#[derive(serde::Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

fn read_directory(path: &str) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<DirEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden files
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(DirEntry { name, path, is_dir })
        })
        .collect();

    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(result)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/terminals", get(list_terminals))
        .route("/api/terminals", post(create_terminal))
        .route("/api/terminals/{id}", delete(destroy_terminal))
        .route("/api/terminals/{id}/resize", post(resize_terminal))
        .route("/api/terminals/{id}/input", post(write_input))
        .route("/api/terminals/{id}/screen", get(read_screen))
        .route("/api/fs/list", get(list_directory))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_directory_tmp() {
        let entries = read_directory("/tmp").unwrap();
        // /tmp should be readable
        assert!(entries.iter().all(|e| !e.name.starts_with('.')));
    }

    #[test]
    fn test_read_directory_invalid() {
        assert!(read_directory("/nonexistent/path").is_err());
    }

    #[test]
    fn test_read_directory_sorted() {
        let entries = read_directory("/").unwrap();
        // Directories should come before files
        let first_file = entries.iter().position(|e| !e.is_dir);
        let last_dir = entries.iter().rposition(|e| e.is_dir);
        if let (Some(ff), Some(ld)) = (first_file, last_dir) {
            assert!(ld < ff);
        }
    }
}
