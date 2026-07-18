use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tc_protocol::{
    DirEntry, MachineInfo, TerminalInfo, WorkspaceGroupInfo, WorkspaceLayoutInfo,
    WorkspaceLayoutNode,
};

use crate::auth::AuthUser;
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateTerminalRequest {
    pub cwd: String,
    #[serde(default)]
    pub workspace_group_id: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default)]
    pub startup_command: Option<String>,
}

#[derive(Deserialize)]
struct CreateWorkspaceGroupRequest {
    name: String,
}

#[derive(Deserialize)]
struct ReorderWorkspaceGroupsRequest {
    group_ids: Vec<String>,
}

#[derive(Deserialize)]
struct AssignWorkspaceGroupRequest {
    workspace_group_id: Option<String>,
}

#[derive(Deserialize)]
struct SaveWorkspaceLayoutRequest {
    group_key: String,
    root: Option<WorkspaceLayoutNode>,
    #[serde(default)]
    base_updated_at: Option<i64>,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

fn workspace_group_info(row: crate::db::types::WorkspaceGroupRow) -> WorkspaceGroupInfo {
    WorkspaceGroupInfo {
        id: row.id,
        machine_id: row.machine_id,
        name: row.name,
        sort_order: row.sort_order,
    }
}

fn control_action_allowed(controller_device_id: Option<&str>, device_id: Option<&str>) -> bool {
    matches!(
        (
            controller_device_id,
            device_id.and_then(|value| (!value.is_empty()).then_some(value)),
        ),
        (Some(controller_device_id), Some(device_id)) if controller_device_id == device_id
    )
}

async fn ensure_machine_row(
    state: &AppState,
    user_id: &str,
    machine_id: &str,
) -> Result<MachineInfo, (StatusCode, String)> {
    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    if let Some(machine) = state
        .manager
        .machine_info_for_user(user_id, machine_id)
        .await
    {
        crate::db::machines::ensure_machine_for_user(
            &conn,
            &machine.id,
            user_id,
            &machine.name,
            Some(&machine.os),
            Some(&machine.home_dir),
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
        return Ok(machine);
    }

    let machine = crate::db::machines::find_machine_by_id(&conn, machine_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?
        .filter(|machine| machine.user_id == user_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Machine not found".to_string()))?;
    Ok(MachineInfo {
        id: machine.id,
        name: machine.name,
        os: machine.os.unwrap_or_default(),
        home_dir: machine.home_dir.unwrap_or_default(),
    })
}

async fn list_machines(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Json<Vec<MachineInfo>> {
    Json(
        state
            .manager
            .list_machines_for_user(&auth_user.user_id)
            .await,
    )
}

async fn list_all_terminals(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Json<Vec<TerminalInfo>> {
    Json(
        state
            .manager
            .list_terminals_for_user(&auth_user.user_id, None)
            .await,
    )
}

async fn list_machine_terminals(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
) -> Result<Json<Vec<TerminalInfo>>, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    Ok(Json(
        state
            .manager
            .list_terminals_for_user(&auth_user.user_id, Some(&machine_id))
            .await,
    ))
}

async fn create_terminal(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<CreateTerminalRequest>,
) -> Result<Json<TerminalInfo>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let controller_device_id = state
        .manager
        .get_controller(&auth_user.user_id, &machine_id);
    if !control_action_allowed(controller_device_id.as_deref(), req.device_id.as_deref()) {
        return Err((StatusCode::FORBIDDEN, "Control required".to_string()));
    }

    if let Some(group_id) = req.workspace_group_id.as_deref() {
        let conn = state.db.get().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
        let valid_group = crate::db::workspace_groups::workspace_group_belongs_to_machine(
            &conn,
            &auth_user.user_id,
            &machine_id,
            group_id,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
        if !valid_group {
            return Err((
                StatusCode::BAD_REQUEST,
                "Workspace tab not found".to_string(),
            ));
        }
    }

    let startup_command = req.startup_command.clone();

    let terminal = state
        .manager
        .create_terminal(&machine_id, &req.cwd, req.cols, req.rows, startup_command)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if let Some(group_id) = req.workspace_group_id {
        return state
            .manager
            .set_terminal_workspace_group(
                &auth_user.user_id,
                &machine_id,
                &terminal.id,
                Some(group_id),
            )
            .await
            .map(Json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    Ok(Json(terminal))
}

async fn list_workspace_groups(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
) -> Result<Json<Vec<WorkspaceGroupInfo>>, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let groups = crate::db::workspace_groups::find_workspace_groups_by_machine(
        &conn,
        &auth_user.user_id,
        &machine_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?
    .into_iter()
    .map(workspace_group_info)
    .collect();

    Ok(Json(groups))
}

async fn save_workspace_layout(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<SaveWorkspaceLayoutRequest>,
) -> Result<Json<WorkspaceLayoutInfo>, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let group_key = req.group_key.trim();
    if group_key.is_empty() || group_key.len() > 1024 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Workspace layout group key is invalid".to_string(),
        ));
    }

    let terminals = state
        .manager
        .list_terminals_for_user(&auth_user.user_id, Some(&machine_id))
        .await;
    let mut conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let allowed_terminal_ids = workspace_layout_terminal_ids_for_group_key(
        &conn,
        &auth_user.user_id,
        &machine_id,
        group_key,
        &terminals,
        req.root.is_some(),
    )
    .map_err(|message| (StatusCode::BAD_REQUEST, message))?;

    if let Some(root) = req.root.as_ref() {
        let mut seen = HashSet::new();
        validate_workspace_layout_node(root, &allowed_terminal_ids, &mut seen, 0)
            .map_err(|message| (StatusCode::BAD_REQUEST, message))?;
    }
    let base_updated_at = req.base_updated_at.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Workspace layout base revision is required".to_string(),
        )
    })?;

    if req.root.is_none() {
        let row = crate::db::workspace_layouts::delete_workspace_layout_checked(
            &mut conn,
            &auth_user.user_id,
            &machine_id,
            group_key,
            base_updated_at,
        )
        .map_err(workspace_layout_save_error)?;
        let layout = workspace_layout_info_from_row(row);
        state
            .manager
            .publish_workspace_layout_updated(&auth_user.user_id, layout.clone());
        return Ok(Json(layout));
    }

    let root_json = serde_json::to_string(&req.root).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Workspace layout is invalid: {}", e),
        )
    })?;
    let row = crate::db::workspace_layouts::upsert_workspace_layout_checked(
        &mut conn,
        &auth_user.user_id,
        &machine_id,
        group_key,
        &root_json,
        base_updated_at,
    )
    .map_err(workspace_layout_save_error)?;

    let layout = workspace_layout_info_from_row(row);
    state
        .manager
        .publish_workspace_layout_updated(&auth_user.user_id, layout.clone());
    Ok(Json(layout))
}

fn workspace_layout_info_from_row(
    row: crate::db::types::WorkspaceLayoutRow,
) -> WorkspaceLayoutInfo {
    let root = serde_json::from_str(&row.root_json).unwrap_or(None);
    WorkspaceLayoutInfo {
        machine_id: row.machine_id,
        group_key: row.group_key,
        root,
        updated_at: row.updated_at,
    }
}

fn workspace_layout_save_error(
    error: crate::db::workspace_layouts::WorkspaceLayoutSaveError,
) -> (StatusCode, String) {
    match error {
        crate::db::workspace_layouts::WorkspaceLayoutSaveError::Conflict => (
            StatusCode::CONFLICT,
            "Workspace layout has changed; reload before saving".to_string(),
        ),
        crate::db::workspace_layouts::WorkspaceLayoutSaveError::Db(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", error),
        ),
    }
}

fn workspace_layout_terminal_ids_for_group_key(
    conn: &rusqlite::Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    terminals: &[TerminalInfo],
    requires_existing_group: bool,
) -> Result<HashSet<String>, String> {
    if crate::db::workspace_groups::workspace_group_belongs_to_machine(
        conn, user_id, machine_id, group_key,
    )
    .map_err(|e| format!("DB error: {}", e))?
    {
        return Ok(terminals
            .iter()
            .filter(|terminal| terminal.workspace_group_id.as_deref() == Some(group_key))
            .map(|terminal| terminal.id.clone())
            .collect());
    }

    let cwd_terminal_ids: Option<HashSet<String>> = group_key.strip_prefix("cwd:").map(|cwd| {
        terminals
            .iter()
            .filter(|terminal| terminal.workspace_group_id.is_none() && terminal.cwd == cwd)
            .map(|terminal| terminal.id.clone())
            .collect()
    });
    if let Some(terminal_ids) = cwd_terminal_ids {
        if !terminal_ids.is_empty() || !requires_existing_group {
            return Ok(terminal_ids);
        }
    }

    Err("Workspace layout group key does not match this machine".to_string())
}

fn validate_workspace_layout_node(
    node: &WorkspaceLayoutNode,
    terminal_ids: &HashSet<String>,
    seen: &mut HashSet<String>,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("Workspace layout is too deep".to_string());
    }

    match node {
        WorkspaceLayoutNode::Leaf { terminal_id } => {
            if !terminal_ids.contains(terminal_id) {
                return Err("Workspace layout references a missing terminal".to_string());
            }
            if !seen.insert(terminal_id.clone()) {
                return Err("Workspace layout references a terminal more than once".to_string());
            }
            Ok(())
        }
        WorkspaceLayoutNode::Split {
            ratio,
            first,
            second,
            ..
        } => {
            if !ratio.is_finite() || *ratio < 0.05 || *ratio > 0.95 {
                return Err("Workspace layout split ratio is invalid".to_string());
            }
            validate_workspace_layout_node(first, terminal_ids, seen, depth + 1)?;
            validate_workspace_layout_node(second, terminal_ids, seen, depth + 1)
        }
    }
}

async fn create_workspace_group(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<CreateWorkspaceGroupRequest>,
) -> Result<Json<WorkspaceGroupInfo>, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Name is required".to_string()));
    }

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let sort_order = crate::db::workspace_groups::find_workspace_groups_by_machine(
        &conn,
        &auth_user.user_id,
        &machine_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?
    .iter()
    .map(|group| group.sort_order)
    .max()
    .map_or(0, |sort_order| sort_order + 1);
    let id = uuid::Uuid::new_v4().to_string();
    let row = crate::db::workspace_groups::create_workspace_group(
        &conn,
        &id,
        &auth_user.user_id,
        &machine_id,
        name,
        sort_order,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;

    let group = WorkspaceGroupInfo {
        id: row.id,
        machine_id: row.machine_id,
        name: row.name,
        sort_order: row.sort_order,
    };
    state
        .manager
        .publish_workspace_group_created(&auth_user.user_id, group.clone());
    Ok(Json(group))
}

async fn reorder_workspace_groups(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Json(req): Json<ReorderWorkspaceGroupsRequest>,
) -> Result<Json<Vec<WorkspaceGroupInfo>>, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let existing = crate::db::workspace_groups::find_workspace_groups_by_machine(
        &conn,
        &auth_user.user_id,
        &machine_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let existing_ids: HashSet<&str> = existing.iter().map(|group| group.id.as_str()).collect();
    let requested_ids: HashSet<&str> = req.group_ids.iter().map(String::as_str).collect();
    if existing_ids != requested_ids || existing.len() != req.group_ids.len() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Workspace tab order must include each tab exactly once".to_string(),
        ));
    }

    for (sort_order, group_id) in req.group_ids.iter().enumerate() {
        crate::db::workspace_groups::update_workspace_group_sort_order(
            &conn,
            &auth_user.user_id,
            &machine_id,
            group_id,
            sort_order as i64,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
    }

    let groups: Vec<WorkspaceGroupInfo> =
        crate::db::workspace_groups::find_workspace_groups_by_machine(
            &conn,
            &auth_user.user_id,
            &machine_id,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?
        .into_iter()
        .map(workspace_group_info)
        .collect();

    for group in &groups {
        state
            .manager
            .publish_workspace_group_updated(&auth_user.user_id, group.clone());
    }

    Ok(Json(groups))
}

async fn delete_workspace_group(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((machine_id, group_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    let conn = state.db.get().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    let valid_group = crate::db::workspace_groups::workspace_group_belongs_to_machine(
        &conn,
        &auth_user.user_id,
        &machine_id,
        &group_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    if !valid_group {
        return Err((StatusCode::NOT_FOUND, "Workspace tab not found".to_string()));
    }

    crate::db::terminal_sessions::clear_workspace_group(&conn, &group_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    crate::db::workspace_layouts::delete_workspace_layout(
        &conn,
        &auth_user.user_id,
        &machine_id,
        &group_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;
    crate::db::workspace_groups::delete_workspace_group(
        &conn,
        &auth_user.user_id,
        &machine_id,
        &group_id,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB error: {}", e),
        )
    })?;

    state
        .manager
        .clear_workspace_group_assignments(&auth_user.user_id, &machine_id, &group_id)
        .await;
    state
        .manager
        .publish_workspace_group_deleted(&auth_user.user_id, &machine_id, &group_id);

    Ok(StatusCode::NO_CONTENT)
}

async fn assign_terminal_workspace_group(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((machine_id, terminal_id)): Path<(String, String)>,
    Json(req): Json<AssignWorkspaceGroupRequest>,
) -> Result<Json<TerminalInfo>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_terminal(&auth_user.user_id, &machine_id, &terminal_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Terminal not found".to_string()));
    }
    ensure_machine_row(&state, &auth_user.user_id, &machine_id).await?;

    if let Some(group_id) = req.workspace_group_id.as_deref() {
        let conn = state.db.get().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
        let valid_group = crate::db::workspace_groups::workspace_group_belongs_to_machine(
            &conn,
            &auth_user.user_id,
            &machine_id,
            group_id,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DB error: {}", e),
            )
        })?;
        if !valid_group {
            return Err((
                StatusCode::BAD_REQUEST,
                "Workspace tab not found".to_string(),
            ));
        }
    }

    state
        .manager
        .set_terminal_workspace_group(
            &auth_user.user_id,
            &machine_id,
            &terminal_id,
            req.workspace_group_id,
        )
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn destroy_terminal(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((machine_id, terminal_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_terminal(&auth_user.user_id, &machine_id, &terminal_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Terminal not found".to_string()));
    }

    let controller_device_id = state
        .manager
        .get_controller(&auth_user.user_id, &machine_id);
    if !control_action_allowed(
        controller_device_id.as_deref(),
        params.get("device_id").map(|value| value.as_str()),
    ) {
        return Err((StatusCode::FORBIDDEN, "Control required".to_string()));
    }

    state
        .manager
        .destroy_terminal(&machine_id, &terminal_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

#[derive(Serialize)]
struct ForegroundProcessResponse {
    has_foreground_process: bool,
    process_name: Option<String>,
}

async fn check_foreground_process(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((machine_id, terminal_id)): Path<(String, String)>,
) -> Result<Json<ForegroundProcessResponse>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_terminal(&auth_user.user_id, &machine_id, &terminal_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Terminal not found".to_string()));
    }

    let (has_fg, process_name) = state
        .manager
        .check_foreground_process(&machine_id, &terminal_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(ForegroundProcessResponse {
        has_foreground_process: has_fg,
        process_name,
    }))
}

async fn list_directory(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    let path = params.get("path").map(|s| s.as_str()).unwrap_or("~");
    state
        .manager
        .list_directory(&machine_id, path)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn get_machine_stats(
    Path(machine_id): Path<String>,
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return StatusCode::NOT_FOUND.into_response();
    }

    match state.manager.get_machine_stats(&machine_id).await {
        Some(stats) => Json(stats).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/machines", get(list_machines))
        .route("/api/terminals", get(list_all_terminals))
        .route(
            "/api/machines/{machine_id}/terminals",
            get(list_machine_terminals),
        )
        .route(
            "/api/machines/{machine_id}/terminals",
            post(create_terminal),
        )
        .route(
            "/api/machines/{machine_id}/workspace-groups",
            get(list_workspace_groups).post(create_workspace_group),
        )
        .route(
            "/api/machines/{machine_id}/workspace-groups/order",
            put(reorder_workspace_groups),
        )
        .route(
            "/api/machines/{machine_id}/workspace-layouts",
            put(save_workspace_layout),
        )
        .route(
            "/api/machines/{machine_id}/workspace-groups/{group_id}",
            delete(delete_workspace_group),
        )
        .route(
            "/api/machines/{machine_id}/terminals/{terminal_id}/workspace-group",
            put(assign_terminal_workspace_group),
        )
        .route(
            "/api/machines/{machine_id}/terminals/{terminal_id}",
            delete(destroy_terminal),
        )
        .route(
            "/api/machines/{machine_id}/terminals/{terminal_id}/foreground-process",
            get(check_foreground_process),
        )
        .route("/api/machines/{machine_id}/fs/list", get(list_directory))
        .route("/api/machines/{machine_id}/stats", get(get_machine_stats))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::{to_bytes, Body},
        extract::{Path, State},
        http::{header, Method, Request, StatusCode},
        Json,
    };
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use serde_json::{json, Value};
    use tc_protocol::{HubToMachine, MachineInfo, MachineToHub, TerminalInfo, WorkspaceLayoutNode};
    use tower::ServiceExt;

    use super::{
        control_action_allowed, create_terminal, create_workspace_group,
        validate_workspace_layout_node, workspace_layout_terminal_ids_for_group_key,
        CreateTerminalRequest, CreateWorkspaceGroupRequest,
    };
    use crate::{
        attach_router::HubRouter,
        auth::{sign_jwt, AuthUser},
        machine_manager::MachineManager,
        AppState,
    };

    fn test_state() -> AppState {
        let pool = Pool::builder()
            .max_size(1)
            .build(SqliteConnectionManager::memory())
            .unwrap();
        let conn = pool.get().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "user-a", "test", "user-a", "User A", None, "admin")
            .unwrap();
        drop(conn);

        AppState {
            manager: Arc::new(MachineManager::new(pool.clone())),
            router: Arc::new(HubRouter::new()),
            db: pool,
            jwt_secret: "test-secret".to_string(),
            base_url: "http://localhost:4317".to_string(),
            dev_mode: false,
            github_client_id: None,
            github_client_secret: None,
            google_client_id: None,
            google_client_secret: None,
        }
    }

    fn machine(id: &str) -> MachineInfo {
        MachineInfo {
            id: id.to_string(),
            name: format!("machine-{id}"),
            os: "linux".to_string(),
            home_dir: "/tmp".to_string(),
        }
    }

    fn terminal(id: &str, cwd: &str, workspace_group_id: Option<&str>) -> TerminalInfo {
        TerminalInfo {
            id: id.to_string(),
            machine_id: "machine-a".to_string(),
            title: format!("Terminal {id}"),
            cwd: cwd.to_string(),
            workspace_group_id: workspace_group_id.map(str::to_string),
            cols: 80,
            rows: 24,
            reachable: true,
        }
    }

    async fn state_with_terminals(terminals: Vec<TerminalInfo>) -> AppState {
        let state = test_state();
        {
            let conn = state.db.get().unwrap();
            crate::db::machines::ensure_machine_for_user(
                &conn,
                "machine-a",
                "user-a",
                "Machine A",
                Some("linux"),
                Some("/tmp"),
            )
            .unwrap();
        }
        state
            .manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        state
            .manager
            .handle_machine_message("machine-a", MachineToHub::ExistingTerminals { terminals })
            .await;
        state
    }

    async fn put_workspace_layout(state: &AppState, body: Value) -> (StatusCode, Value) {
        let token = sign_jwt("user-a", &state.jwt_secret);
        let response = super::router()
            .with_state(state.clone())
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/api/machines/machine-a/workspace-layouts")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()))
        };
        (status, body)
    }

    async fn receive_create_terminal_command(
        state: &AppState,
        cmd_rx: &mut tokio::sync::mpsc::Receiver<HubToMachine>,
    ) -> Option<String> {
        let command = cmd_rx.recv().await.unwrap();
        let (request_id, startup_command) = match command {
            HubToMachine::CreateTerminal {
                request_id,
                startup_command,
                ..
            } => (request_id, startup_command),
            other => panic!("unexpected machine command: {other:?}"),
        };

        state
            .manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::TerminalCreated {
                    request_id: request_id.clone(),
                    terminal_id: "terminal-a".to_string(),
                    title: "Terminal terminal-a".to_string(),
                    cwd: "/tmp".to_string(),
                    cols: 80,
                    rows: 24,
                },
            )
            .await;

        startup_command
    }

    async fn startup_command_sent_to_machine(
        request_startup_command: Option<&str>,
    ) -> Option<String> {
        let state = test_state();
        {
            let conn = state.db.get().unwrap();
            crate::db::settings::set_user_setting(
                &conn,
                "user-a",
                "default_startup_command",
                "echo should-not-run",
            )
            .unwrap();
        }
        let (_conn_id, mut cmd_rx) = state
            .manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        state
            .manager
            .request_control("user-a", "machine-a", "device-a");

        let state_for_request = state.clone();
        let startup_command = request_startup_command.map(str::to_string);
        let request = tokio::spawn(async move {
            create_terminal(
                State(state_for_request),
                AuthUser {
                    user_id: "user-a".to_string(),
                },
                Path("machine-a".to_string()),
                Json(CreateTerminalRequest {
                    cwd: "/tmp".to_string(),
                    workspace_group_id: None,
                    device_id: Some("device-a".to_string()),
                    cols: 80,
                    rows: 24,
                    startup_command,
                }),
            )
            .await
        });

        let startup_command = receive_create_terminal_command(&state, &mut cmd_rx).await;
        let _ = request.await.unwrap().unwrap();

        startup_command
    }

    #[test]
    fn control_action_requires_matching_device_id() {
        assert!(control_action_allowed(Some("device-a"), Some("device-a")));
        assert!(!control_action_allowed(Some("device-a"), Some("device-b")));
        assert!(!control_action_allowed(Some("device-a"), None));
        assert!(!control_action_allowed(Some("device-a"), Some("")));
        assert!(!control_action_allowed(None, Some("device-a")));
    }

    #[test]
    fn workspace_layout_cwd_key_only_allows_matching_ungrouped_terminals() {
        let state = test_state();
        let conn = state.db.get().unwrap();
        crate::db::machines::ensure_machine_for_user(
            &conn,
            "machine-a",
            "user-a",
            "Machine A",
            Some("linux"),
            Some("/tmp"),
        )
        .unwrap();
        let terminals = vec![
            terminal("repo-a", "/repo", None),
            terminal("repo-grouped", "/repo", Some("group-a")),
            terminal("other-a", "/other", None),
        ];

        let allowed = workspace_layout_terminal_ids_for_group_key(
            &conn,
            "user-a",
            "machine-a",
            "cwd:/repo",
            &terminals,
            true,
        )
        .unwrap();

        assert!(allowed.contains("repo-a"));
        assert!(!allowed.contains("repo-grouped"));
        assert!(!allowed.contains("other-a"));
        let mut seen = Default::default();
        assert!(validate_workspace_layout_node(
            &WorkspaceLayoutNode::Leaf {
                terminal_id: "repo-grouped".to_string(),
            },
            &allowed,
            &mut seen,
            0,
        )
        .is_err());
    }

    #[test]
    fn workspace_layout_tab_key_only_allows_terminals_in_that_tab() {
        let state = test_state();
        let conn = state.db.get().unwrap();
        crate::db::machines::ensure_machine_for_user(
            &conn,
            "machine-a",
            "user-a",
            "Machine A",
            Some("linux"),
            Some("/tmp"),
        )
        .unwrap();
        crate::db::workspace_groups::create_workspace_group(
            &conn,
            "group-a",
            "user-a",
            "machine-a",
            "Group A",
            0,
        )
        .unwrap();
        let terminals = vec![
            terminal("tab-a", "/repo", Some("group-a")),
            terminal("cwd-a", "/repo", None),
            terminal("other-tab-a", "/repo", Some("group-b")),
        ];

        let allowed = workspace_layout_terminal_ids_for_group_key(
            &conn,
            "user-a",
            "machine-a",
            "group-a",
            &terminals,
            true,
        )
        .unwrap();

        assert!(allowed.contains("tab-a"));
        assert!(!allowed.contains("cwd-a"));
        assert!(!allowed.contains("other-tab-a"));
        let mut seen = Default::default();
        assert!(validate_workspace_layout_node(
            &WorkspaceLayoutNode::Leaf {
                terminal_id: "cwd-a".to_string(),
            },
            &allowed,
            &mut seen,
            0,
        )
        .is_err());
    }

    #[test]
    fn workspace_layout_rejects_unknown_non_empty_cwd_key() {
        let state = test_state();
        let conn = state.db.get().unwrap();
        crate::db::machines::ensure_machine_for_user(
            &conn,
            "machine-a",
            "user-a",
            "Machine A",
            Some("linux"),
            Some("/tmp"),
        )
        .unwrap();
        let terminals = vec![terminal("repo-a", "/repo", None)];

        assert!(workspace_layout_terminal_ids_for_group_key(
            &conn,
            "user-a",
            "machine-a",
            "cwd:/missing",
            &terminals,
            true,
        )
        .is_err());
        assert!(workspace_layout_terminal_ids_for_group_key(
            &conn,
            "user-a",
            "machine-a",
            "cwd:/missing",
            &terminals,
            false,
        )
        .is_ok());
    }

    #[tokio::test]
    async fn workspace_layout_route_saves_and_deletes_cwd_layout() {
        let state = state_with_terminals(vec![
            terminal("repo-a", "/repo", None),
            terminal("repo-b", "/repo", None),
        ])
        .await;

        let (status, body) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": {
                    "type": "split",
                    "direction": "horizontal",
                    "ratio": 0.5,
                    "first": { "type": "leaf", "terminalId": "repo-a" },
                    "second": { "type": "leaf", "terminalId": "repo-b" }
                },
                "base_updated_at": -1
            }),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["group_key"], "cwd:/repo");
        let updated_at = body["updated_at"].as_i64().unwrap();
        let conn = state.db.get().unwrap();
        assert!(crate::db::workspace_layouts::find_workspace_layout(
            &conn,
            "user-a",
            "machine-a",
            "cwd:/repo"
        )
        .unwrap()
        .is_some());
        drop(conn);

        let (status, body) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": null,
                "base_updated_at": updated_at
            }),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["root"].is_null());
        let conn = state.db.get().unwrap();
        let row = crate::db::workspace_layouts::find_workspace_layout(
            &conn,
            "user-a",
            "machine-a",
            "cwd:/repo",
        )
        .unwrap()
        .unwrap();
        let decoded: Option<WorkspaceLayoutNode> = serde_json::from_str(&row.root_json).unwrap();
        assert!(decoded.is_none());
        drop(conn);

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-a" },
                "base_updated_at": updated_at
            }),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-a" }
            }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn workspace_layout_route_rejects_terminals_outside_group_key() {
        let state = state_with_terminals(vec![
            terminal("tab-a", "/repo", Some("group-a")),
            terminal("tab-b", "/repo", Some("group-b")),
            terminal("cwd-a", "/repo", None),
        ])
        .await;
        {
            let conn = state.db.get().unwrap();
            crate::db::workspace_groups::create_workspace_group(
                &conn,
                "group-a",
                "user-a",
                "machine-a",
                "Group A",
                0,
            )
            .unwrap();
            crate::db::workspace_groups::create_workspace_group(
                &conn,
                "group-b",
                "user-a",
                "machine-a",
                "Group B",
                1,
            )
            .unwrap();
        }

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "group-a",
                "root": { "type": "leaf", "terminalId": "tab-b" },
                "base_updated_at": -1
            }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "tab-a" },
                "base_updated_at": -1
            }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn workspace_layout_route_rejects_stale_save_revision() {
        let state = state_with_terminals(vec![
            terminal("repo-a", "/repo", None),
            terminal("repo-b", "/repo", None),
        ])
        .await;

        let (status, first) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-a" },
                "base_updated_at": -1
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let first_updated_at = first["updated_at"].as_i64().unwrap();

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-b" },
                "base_updated_at": -1
            }),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, second) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-b" },
                "base_updated_at": first_updated_at
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(second["updated_at"].as_i64().unwrap() > first_updated_at);

        let (status, _) = put_workspace_layout(
            &state,
            json!({
                "group_key": "cwd:/repo",
                "root": { "type": "leaf", "terminalId": "repo-a" },
                "base_updated_at": first_updated_at
            }),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_terminal_ignores_default_startup_command_when_request_has_none() {
        let startup_command = startup_command_sent_to_machine(None).await;
        assert_eq!(startup_command, None);
    }

    #[tokio::test]
    async fn create_terminal_keeps_explicit_startup_command() {
        let startup_command = startup_command_sent_to_machine(Some("echo explicit")).await;
        assert_eq!(startup_command, Some("echo explicit".to_string()));
    }

    #[tokio::test]
    async fn create_workspace_group_appends_after_deleted_order_gaps() {
        let state = test_state();
        {
            let conn = state.db.get().unwrap();
            crate::db::machines::ensure_machine_for_user(
                &conn,
                "machine-a",
                "user-a",
                "Machine A",
                Some("linux"),
                Some("/tmp"),
            )
            .unwrap();
            crate::db::workspace_groups::create_workspace_group(
                &conn,
                "group-a",
                "user-a",
                "machine-a",
                "First",
                0,
            )
            .unwrap();
            crate::db::workspace_groups::create_workspace_group(
                &conn,
                "group-c",
                "user-a",
                "machine-a",
                "Third",
                2,
            )
            .unwrap();
        }

        let Json(group) = create_workspace_group(
            State(state),
            AuthUser {
                user_id: "user-a".to_string(),
            },
            Path("machine-a".to_string()),
            Json(CreateWorkspaceGroupRequest {
                name: "New".to_string(),
            }),
        )
        .await
        .unwrap();

        assert_eq!(group.sort_order, 3);
    }
}
