use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tc_protocol::{DirEntry, MachineInfo, TerminalInfo, WorkspaceGroupInfo};

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
struct AssignWorkspaceGroupRequest {
    workspace_group_id: Option<String>,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
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
    .map(|group| WorkspaceGroupInfo {
        id: group.id,
        machine_id: group.machine_id,
        name: group.name,
        sort_order: group.sort_order,
    })
    .collect();

    Ok(Json(groups))
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
    .len() as i64;
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
        extract::{Path, State},
        Json,
    };
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use tc_protocol::{HubToMachine, MachineInfo, MachineToHub};

    use super::{control_action_allowed, create_terminal, CreateTerminalRequest};
    use crate::{
        attach_router::HubRouter, auth::AuthUser, machine_manager::MachineManager, AppState,
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
            native_zellij_allow_insecure_tls: false,
            native_zellij_ca_cert_pem: None,
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
}
