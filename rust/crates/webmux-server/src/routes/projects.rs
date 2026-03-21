use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use webmux_shared::{
    CreateProjectRequest, Project, ProjectAction, ProjectDetailResponse, ProjectListResponse,
    RunTool, Task, TaskStatus, UpdateProjectRequest,
};

use crate::auth::AuthUser;
use crate::db::agents::find_agent_by_id;
use crate::db::projects::{
    create_project, delete_project, find_project_by_id, find_projects_by_user_id, update_project,
    CreateProjectOpts, UpdateProjectOpts,
    find_project_actions_by_project_id,
};
use crate::db::tasks::find_tasks_by_project_id;
use crate::db::types::{ProjectActionRow, ProjectRow, TaskRow};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Row-to-shared-type helpers
// ---------------------------------------------------------------------------

pub fn project_row_to_project(row: &ProjectRow) -> Project {
    Project {
        id: row.id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        repo_path: row.repo_path.clone(),
        agent_id: row.agent_id.clone(),
        default_tool: serde_json::from_str(&format!("\"{}\"", row.default_tool))
            .unwrap_or(RunTool::Claude),
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
    }
}

pub fn task_row_to_task(row: &TaskRow) -> Task {
    Task {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        title: row.title.clone(),
        prompt: row.prompt.clone(),
        tool: serde_json::from_str(&format!(
            "\"{}\"",
            row.tool.as_deref().unwrap_or("claude")
        ))
        .unwrap_or(RunTool::Claude),
        status: serde_json::from_str(&format!("\"{}\"", row.status))
            .unwrap_or(TaskStatus::Pending),
        priority: row.priority,
        branch_name: row.branch_name.clone(),
        worktree_path: row.worktree_path.clone(),
        run_id: row.run_id.clone(),
        error_message: row.error_message.clone(),
        summary: row.summary.clone(),
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
        claimed_at: row.claimed_at.map(|t| t as f64),
        completed_at: row.completed_at.map(|t| t as f64),
    }
}

pub fn action_row_to_action(row: &ProjectActionRow) -> ProjectAction {
    ProjectAction {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        prompt: row.prompt.clone(),
        tool: serde_json::from_str(&format!("\"{}\"", row.tool)).unwrap_or(RunTool::Claude),
        sort_order: row.sort_order,
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
    }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/projects", get(list_projects))
        .route("/projects/{id}", get(get_project_detail))
        .route("/projects", post(create_project_handler))
        .route("/projects/{id}", patch(update_project_handler))
        .route("/projects/{id}", delete(delete_project_handler))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/projects
async fn list_projects(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let rows = find_projects_by_user_id(&conn, &user_id).map_err(|e| e.to_string())?;
        let projects: Vec<Project> = rows.iter().map(project_row_to_project).collect();
        Ok::<_, String>(ProjectListResponse { projects })
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
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

/// GET /api/projects/:id
async fn get_project_detail(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project = find_project_by_id(&conn, &id).map_err(|e| e.to_string())?;
        match project {
            None => Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => Err("not_found".to_string()),
            Some(p) => {
                let task_rows =
                    find_tasks_by_project_id(&conn, &id).map_err(|e| e.to_string())?;
                let action_rows =
                    find_project_actions_by_project_id(&conn, &id).map_err(|e| e.to_string())?;
                Ok(ProjectDetailResponse {
                    project: project_row_to_project(&p),
                    tasks: task_rows.iter().map(task_row_to_task).collect(),
                    actions: action_rows.iter().map(action_row_to_action).collect(),
                })
            }
        }
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Project not found" })),
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

/// POST /api/projects
async fn create_project_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<CreateProjectRequest>,
) -> impl IntoResponse {
    let name = body.name.trim().to_string();
    let repo_path = body.repo_path.trim().to_string();
    let agent_id = body.agent_id.trim().to_string();

    if name.is_empty() || repo_path.is_empty() || agent_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing required fields: name, repoPath, agentId" })),
        )
            .into_response();
    }

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let description = body.description.as_deref().map(|s| s.trim().to_string());
    let default_tool = body
        .default_tool
        .as_ref()
        .map(|t| {
            serde_json::to_string(t)
                .unwrap_or_else(|_| "\"claude\"".to_string())
                .trim_matches('"')
                .to_string()
        });

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;

        // Verify agent belongs to user
        let agent = find_agent_by_id(&conn, &agent_id).map_err(|e| e.to_string())?;
        match agent {
            None => return Err("agent_not_found".to_string()),
            Some(a) if a.user_id != user_id => return Err("agent_not_found".to_string()),
            _ => {}
        }

        let project = create_project(
            &conn,
            CreateProjectOpts {
                user_id: &user_id,
                agent_id: &agent_id,
                name: &name,
                description: description.as_deref(),
                repo_path: &repo_path,
                default_tool: default_tool.as_deref(),
            },
        )
        .map_err(|e| e.to_string())?;

        Ok(project_row_to_project(&project))
    })
    .await;

    match result {
        Ok(Ok(project)) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "project": project })),
        )
            .into_response(),
        Ok(Err(e)) if e == "agent_not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Agent not found" })),
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

/// PATCH /api/projects/:id
async fn update_project_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateProjectRequest>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let name = body.name.as_deref().map(|s| s.trim().to_string());
    let description = body.description.as_deref().map(|s| s.trim().to_string());
    let default_tool = body.default_tool.as_ref().map(|t| {
        serde_json::to_string(t)
            .unwrap_or_else(|_| "\"claude\"".to_string())
            .trim_matches('"')
            .to_string()
    });

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project = find_project_by_id(&conn, &id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        update_project(
            &conn,
            &id,
            UpdateProjectOpts {
                name: name.as_deref(),
                description: description.as_deref(),
                default_tool: default_tool.as_deref(),
            },
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Project not found" })),
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

/// DELETE /api/projects/:id
async fn delete_project_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project = find_project_by_id(&conn, &id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        delete_project(&conn, &id).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Project not found" })),
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
