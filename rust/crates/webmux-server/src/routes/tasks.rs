use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use serde::Deserialize;
use webmux_shared::{
    CreateTaskRequest, RunImageAttachmentUpload, StepStatus, StepType, TaskMessage,
    TaskMessageRole, TaskStep, UpdateTaskRequest,
};

use crate::auth::AuthUser;
use crate::db::projects::find_project_by_id;
use crate::db::runs::find_run_by_id;
use crate::db::tasks::{
    create_task, create_task_message, delete_task, find_messages_by_task_id, find_steps_by_task_id,
    find_task_by_id, reset_task_to_pending, update_task_prompt, update_task_status,
    update_task_summary, CreateTaskOpts, UpdateTaskPromptOpts,
};
use crate::db::types::{TaskMessageRow, TaskStepRow};
use crate::routes::projects::task_row_to_task;
use crate::state::AppState;
use crate::ws::agent_hub;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryTaskRequest {
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTaskMessageRequest {
    pub content: String,
    pub attachments: Option<Vec<RunImageAttachmentUpload>>,
}

// ---------------------------------------------------------------------------
// Row-to-shared-type helpers
// ---------------------------------------------------------------------------

fn task_step_row_to_task_step(row: &TaskStepRow) -> TaskStep {
    TaskStep {
        id: row.id.clone(),
        task_id: row.task_id.clone(),
        step_type: serde_json::from_str(&format!("\"{}\"", row.step_type))
            .unwrap_or(StepType::Think),
        label: row.label.clone(),
        status: serde_json::from_str(&format!("\"{}\"", row.status))
            .unwrap_or(StepStatus::Running),
        detail: row.detail.clone(),
        tool_name: row.tool_name.clone(),
        run_id: row.run_id.clone(),
        duration_ms: row.duration_ms.map(|d| d as f64),
        created_at: row.created_at as f64,
        completed_at: row.completed_at.map(|t| t as f64),
    }
}

fn task_message_row_to_task_message(row: &TaskMessageRow) -> TaskMessage {
    TaskMessage {
        id: row.id.clone(),
        task_id: row.task_id.clone(),
        role: serde_json::from_str(&format!("\"{}\"", row.role))
            .unwrap_or(TaskMessageRole::User),
        content: row.content.clone(),
        created_at: row.created_at as f64,
    }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // POST /api/projects/:id/tasks — create task
        .route("/projects/{project_id}/tasks", post(create_task_handler))
        // GET /api/projects/:id/tasks — list tasks for project
        .route("/projects/{project_id}/tasks", get(list_tasks))
        // PATCH /api/projects/:id/tasks/:taskId — update task
        .route("/projects/{project_id}/tasks/{task_id}", patch(update_task_handler))
        // DELETE /api/projects/:id/tasks/:taskId — delete task
        .route("/projects/{project_id}/tasks/{task_id}", delete(delete_task_handler))
        // POST /api/projects/:id/tasks/:taskId/retry — retry failed task
        .route("/projects/{project_id}/tasks/{task_id}/retry", post(retry_task))
        // POST /api/projects/:id/tasks/:taskId/complete — mark task completed
        .route("/projects/{project_id}/tasks/{task_id}/complete", post(complete_task))
        // GET /api/projects/:id/tasks/:taskId/steps — get task steps
        .route("/projects/{project_id}/tasks/{task_id}/steps", get(get_task_steps))
        // GET /api/projects/:id/tasks/:taskId/messages — get task messages
        .route("/projects/{project_id}/tasks/{task_id}/messages", get(get_task_messages))
        // POST /api/projects/:id/tasks/:taskId/messages — send task message
        .route("/projects/{project_id}/tasks/{task_id}/messages", post(send_task_message))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/projects/:projectId/tasks
async fn create_task_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing required field: title" })),
        )
            .into_response();
    }

    let prompt = body
        .prompt
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&title)
        .to_string();

    let tool = body.tool.as_ref().map(|t| {
        serde_json::to_string(t)
            .unwrap_or_else(|_| "\"claude\"".to_string())
            .trim_matches('"')
            .to_string()
    });

    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let priority = body.priority;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project =
            find_project_by_id(&conn, &project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        let task = create_task(
            &conn,
            CreateTaskOpts {
                project_id: &project_id,
                title: &title,
                prompt: &prompt,
                priority,
                tool: tool.as_deref(),
            },
        )
        .map_err(|e| e.to_string())?;

        Ok((task_row_to_task(&task), project_id))
    })
    .await;

    match result {
        Ok(Ok((task, pid))) => {
            // Trigger dispatch
            let hub = state.hub.read().await;
            crate::ws::task_dispatcher::dispatch_pending_tasks_for_project(&hub, &state.db, &pid);

            (
                StatusCode::CREATED,
                Json(serde_json::json!({ "task": task })),
            )
                .into_response()
        }
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

/// GET /api/projects/:id/tasks — list tasks for a project
async fn list_tasks(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let project =
            find_project_by_id(&conn, &project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        let task_rows =
            crate::db::tasks::find_tasks_by_project_id(&conn, &project_id).map_err(|e| e.to_string())?;
        let tasks: Vec<_> = task_rows.iter().map(task_row_to_task).collect();
        Ok::<_, String>(tasks)
    })
    .await;

    match result {
        Ok(Ok(tasks)) => {
            (StatusCode::OK, Json(serde_json::json!({ "tasks": tasks }))).into_response()
        }
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

/// Standalone task detail — not currently registered as a route (tasks are nested under projects)
#[allow(dead_code)]
async fn get_task_detail(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        // Verify ownership via project
        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        // Optionally load the associated run
        let run = if let Some(ref run_id) = task.run_id {
            find_run_by_id(&conn, run_id)
                .map_err(|e| e.to_string())?
                .map(|r| agent_hub::run_row_to_run(&r))
        } else {
            None
        };

        Ok(webmux_shared::TaskDetailResponse {
            task: task_row_to_task(&task),
            run,
        })
    })
    .await;

    match result {
        Ok(Ok(resp)) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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

/// GET /api/projects/:id/tasks/:taskId/steps
async fn get_task_steps(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        let steps = find_steps_by_task_id(&conn, &id).map_err(|e| e.to_string())?;
        let steps: Vec<TaskStep> = steps.iter().map(task_step_row_to_task_step).collect();
        Ok(steps)
    })
    .await;

    match result {
        Ok(Ok(steps)) => {
            (StatusCode::OK, Json(serde_json::json!({ "steps": steps }))).into_response()
        }
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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

/// GET /api/projects/:id/tasks/:taskId/messages
async fn get_task_messages(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        let rows = find_messages_by_task_id(&conn, &id).map_err(|e| e.to_string())?;
        let messages: Vec<TaskMessage> = rows.iter().map(task_message_row_to_task_message).collect();
        Ok(messages)
    })
    .await;

    match result {
        Ok(Ok(messages)) => {
            (StatusCode::OK, Json(serde_json::json!({ "messages": messages }))).into_response()
        }
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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

/// PATCH /api/projects/:id/tasks/:taskId
async fn update_task_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
    Json(body): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let title = body.title.as_deref().map(|s| s.trim().to_string());
    let prompt = body.prompt.as_deref().map(|s| s.trim().to_string());
    let priority = body.priority;

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        if task.status != "pending" {
            return Err("not_pending".to_string());
        }

        update_task_prompt(
            &conn,
            &id,
            UpdateTaskPromptOpts {
                title: title.as_deref(),
                prompt: prompt.as_deref(),
                priority,
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
            Json(serde_json::json!({ "error": "Task not found" })),
        )
            .into_response(),
        Ok(Err(e)) if e == "not_pending" => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Can only edit pending tasks" })),
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

/// DELETE /api/projects/:id/tasks/:taskId
async fn delete_task_handler(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        delete_task(&conn, &id).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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

/// POST /api/projects/:id/tasks/:taskId/complete
async fn complete_task(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            _ => {}
        }

        update_task_status(&conn, &id, "completed", None).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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

/// POST /api/projects/:id/tasks/:taskId/retry
async fn retry_task(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
    body: Option<Json<RetryTaskRequest>>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let additional_prompt = body
        .and_then(|b| b.prompt.as_deref().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty());

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get().map_err(|e| e.to_string())?;
        let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let task = match task {
            None => return Err("not_found".to_string()),
            Some(t) => t,
        };

        let project =
            find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
        let project = match project {
            None => return Err("not_found".to_string()),
            Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
            Some(p) => p,
        };

        if task.status != "failed" {
            return Err("not_failed".to_string());
        }

        reset_task_to_pending(&conn, &id, additional_prompt.as_deref())
            .map_err(|e| e.to_string())?;

        let updated_task = find_task_by_id(&conn, &id)
            .map_err(|e| e.to_string())?
            .unwrap();

        Ok((task_row_to_task(&updated_task), project.id))
    })
    .await;

    match result {
        Ok(Ok((task, project_id))) => {
            let hub = state.hub.read().await;
            crate::ws::task_dispatcher::dispatch_pending_tasks_for_project(&hub, &state.db, &project_id);

            (StatusCode::OK, Json(serde_json::json!({ "task": task }))).into_response()
        }
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
        )
            .into_response(),
        Ok(Err(e)) if e == "not_failed" => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Can only retry failed tasks" })),
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

/// POST /api/projects/:id/tasks/:taskId/messages
async fn send_task_message(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((_project_id, id)): Path<(String, String)>,
    Json(body): Json<SendTaskMessageRequest>,
) -> impl IntoResponse {
    let content = body.content.trim().to_string();
    if content.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Content is required" })),
        )
            .into_response();
    }

    let attachments = body.attachments.clone();
    let db = state.db.clone();
    let user_id = auth_user.user_id.clone();
    let hub = state.hub.clone();

    let result = tokio::task::spawn_blocking({
        let content = content.clone();
        move || {
            let conn = db.get().map_err(|e| e.to_string())?;
            let task = find_task_by_id(&conn, &id).map_err(|e| e.to_string())?;
            let task = match task {
                None => return Err("not_found".to_string()),
                Some(t) => t,
            };

            let project =
                find_project_by_id(&conn, &task.project_id).map_err(|e| e.to_string())?;
            match project {
                None => return Err("not_found".to_string()),
                Some(p) if p.user_id != user_id => return Err("not_found".to_string()),
                _ => {}
            }

            // Store user message
            let msg_row =
                create_task_message(&conn, &id, "user", &content, None).map_err(|e| e.to_string())?;
            let message = task_message_row_to_task_message(&msg_row);

            Ok((message, task.status, task.prompt, id))
        }
    })
    .await;

    match result {
        Ok(Ok((message, task_status, task_prompt, task_id))) => {
            if task_status == "waiting" {
                // Agent is waiting -- send reply to agent, update status to running
                let db = state.db.clone();
                let tid = task_id.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let conn = db.get().ok()?;
                    update_task_status(&conn, &tid, "running", None).ok()
                })
                .await;

                let hub = hub.read().await;
                if let Ok(conn) = state.db.get() {
                    agent_hub::send_user_reply_to_agent(
                        &hub,
                        &conn,
                        &task_id,
                        attachments.map(|a| a.to_vec()),
                    );
                    agent_hub::broadcast_task_snapshot(&hub, &conn, &task_id);
                }
            } else if task_status == "completed" || task_status == "failed" {
                // Task is done -- re-dispatch with follow-up
                let db = state.db.clone();
                let tid = task_id.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let conn = db.get().ok()?;
                    update_task_status(&conn, &tid, "dispatched", None).ok()?;
                    update_task_summary(&conn, &tid, "").ok()
                })
                .await;

                let follow_up_prompt =
                    format!("{}\n\nUser follow-up:\n{}", task_prompt, content);
                let hub = hub.read().await;
                crate::ws::task_dispatcher::dispatch_single_task(
                    &hub,
                    &state.db,
                    &task_id,
                    Some(&follow_up_prompt),
                    attachments.map(|a| a.to_vec()),
                );
            }

            (
                StatusCode::CREATED,
                Json(serde_json::json!({ "message": message })),
            )
                .into_response()
        }
        Ok(Err(e)) if e == "not_found" => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
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
