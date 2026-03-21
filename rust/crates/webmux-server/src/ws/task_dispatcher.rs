use tracing::error;

use webmux_shared::{LlmConfigInline, RunTool, ServerToAgentMessage};

use crate::db::types::TaskRow;
use crate::db::DbPool;
use crate::ws::agent_hub::AgentHub;

/// Dispatch all pending tasks for a specific agent.
///
/// Called when an agent comes online — find all projects assigned to it and
/// dispatch any pending tasks.
pub fn dispatch_pending_tasks_for_agent(
    hub: &AgentHub,
    db: &DbPool,
    agent_id: &str,
) {
    if !hub.is_agent_online(agent_id) {
        return;
    }

    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get DB connection for task dispatch: {}", e);
            return;
        }
    };

    let projects = match crate::db::projects::find_projects_by_agent_id(&conn, agent_id) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to find projects for agent {}: {}", agent_id, e);
            return;
        }
    };

    for project in &projects {
        let pending = match crate::db::tasks::find_pending_tasks_by_project_id(&conn, &project.id)
        {
            Ok(p) => p,
            Err(e) => {
                error!(
                    "Failed to find pending tasks for project {}: {}",
                    project.id, e
                );
                continue;
            }
        };
        for task in &pending {
            dispatch_task(
                hub,
                &conn,
                agent_id,
                task,
                &project.repo_path,
                &project.default_tool,
                &project.user_id,
            );
        }
    }
}

/// Dispatch all pending tasks for a specific project.
pub fn dispatch_pending_tasks_for_project(
    hub: &AgentHub,
    db: &DbPool,
    project_id: &str,
) {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    let project = match crate::db::projects::find_project_by_id(&conn, project_id) {
        Ok(Some(p)) => p,
        Ok(None) => return,
        Err(e) => {
            error!("Failed to find project {}: {}", project_id, e);
            return;
        }
    };

    if !hub.is_agent_online(&project.agent_id) {
        return;
    }

    let pending = match crate::db::tasks::find_pending_tasks_by_project_id(&conn, project_id) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to find pending tasks for project {}: {}", project_id, e);
            return;
        }
    };

    for task in &pending {
        dispatch_task(
            hub,
            &conn,
            &project.agent_id,
            task,
            &project.repo_path,
            &project.default_tool,
            &project.user_id,
        );
    }
}

/// Dispatch a single task by id, optionally overriding prompt/attachments.
pub fn dispatch_single_task(
    hub: &AgentHub,
    db: &DbPool,
    task_id: &str,
    override_prompt: Option<&str>,
    attachments: Option<Vec<webmux_shared::RunImageAttachmentUpload>>,
) {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    // Join task with project to get agent_id, repo_path, etc.
    let row: Option<(TaskRow, String, String, String, String)> = conn
        .prepare(
            "SELECT t.*, p.agent_id, p.repo_path, p.default_tool, p.user_id
             FROM tasks t JOIN projects p ON t.project_id = p.id
             WHERE t.id = ?",
        )
        .and_then(|mut stmt| {
            let mut rows = stmt.query_map(rusqlite::params![task_id], |row| {
                let task = TaskRow {
                    id: row.get("id")?,
                    project_id: row.get("project_id")?,
                    title: row.get("title")?,
                    prompt: row.get("prompt")?,
                    tool: row.get("tool")?,
                    status: row.get("status")?,
                    priority: row.get("priority")?,
                    branch_name: row.get("branch_name")?,
                    worktree_path: row.get("worktree_path")?,
                    run_id: row.get("run_id")?,
                    error_message: row.get("error_message")?,
                    summary: row.get("summary")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                    claimed_at: row.get("claimed_at")?,
                    completed_at: row.get("completed_at")?,
                };
                let agent_id: String = row.get("agent_id")?;
                let repo_path: String = row.get("repo_path")?;
                let default_tool: String = row.get("default_tool")?;
                let user_id: String = row.get("user_id")?;
                Ok((task, agent_id, repo_path, default_tool, user_id))
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .unwrap_or(None);

    let Some((task, agent_id, repo_path, default_tool, user_id)) = row else {
        return;
    };

    // Resolve LLM config
    let llm_config = crate::db::llm_configs::resolve_llm_config(
        &conn,
        &user_id,
        Some(&task.project_id),
    )
    .ok()
    .flatten();

    let tool_str = task.tool.as_deref().unwrap_or(&default_tool);
    let tool: RunTool = serde_json::from_str(&format!("\"{}\"", tool_str))
        .unwrap_or(RunTool::Claude);

    let prompt = override_prompt.unwrap_or(&task.prompt);

    let msg = ServerToAgentMessage::TaskDispatch {
        task_id: task.id.clone(),
        project_id: task.project_id.clone(),
        repo_path,
        tool,
        title: task.title.clone(),
        prompt: prompt.to_string(),
        llm_config: llm_config.map(|c| LlmConfigInline {
            api_base_url: c.api_base_url,
            api_key: c.api_key,
            model: c.model,
        }),
        attachments,
    };

    let sent = hub.send_to_agent(&agent_id, &msg);
    if sent {
        let _ = crate::db::tasks::update_task_status(&conn, task_id, "dispatched", None);
    }
}

/// Internal helper to dispatch a single task given project info.
fn dispatch_task(
    hub: &AgentHub,
    conn: &rusqlite::Connection,
    agent_id: &str,
    task: &TaskRow,
    repo_path: &str,
    default_tool: &str,
    user_id: &str,
) {
    let llm_config = crate::db::llm_configs::resolve_llm_config(
        conn,
        user_id,
        Some(&task.project_id),
    )
    .ok()
    .flatten();

    let tool_str = task.tool.as_deref().unwrap_or(default_tool);
    let tool: RunTool = serde_json::from_str(&format!("\"{}\"", tool_str))
        .unwrap_or(RunTool::Claude);

    // Load persisted attachments for this task
    let attachments = crate::db::tasks::find_task_attachments_for_dispatch(conn, &task.id)
        .ok()
        .filter(|a| !a.is_empty());

    let msg = ServerToAgentMessage::TaskDispatch {
        task_id: task.id.clone(),
        project_id: task.project_id.clone(),
        repo_path: repo_path.to_string(),
        tool,
        title: task.title.clone(),
        prompt: task.prompt.clone(),
        llm_config: llm_config.map(|c| LlmConfigInline {
            api_base_url: c.api_base_url,
            api_key: c.api_key,
            model: c.model,
        }),
        attachments,
    };

    let sent = hub.send_to_agent(agent_id, &msg);
    if sent {
        let _ = crate::db::tasks::update_task_status(conn, &task.id, "dispatched", None);
    }
}
