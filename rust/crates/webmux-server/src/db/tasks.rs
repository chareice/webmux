use rusqlite::{Connection, params};
use uuid::Uuid;

use super::types::{TaskRow, TaskStepRow, TaskMessageRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
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
    })
}

fn row_to_task_step(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskStepRow> {
    Ok(TaskStepRow {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        step_type: row.get("type")?,
        label: row.get("label")?,
        status: row.get("status")?,
        detail: row.get("detail")?,
        tool_name: row.get("tool_name")?,
        run_id: row.get("run_id")?,
        duration_ms: row.get("duration_ms")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_task_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskMessageRow> {
    Ok(TaskMessageRow {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        role: row.get("role")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
    })
}

// --- Tasks ---

pub struct CreateTaskOpts<'a> {
    pub project_id: &'a str,
    pub title: &'a str,
    pub prompt: &'a str,
    pub priority: Option<i64>,
    pub tool: Option<&'a str>,
}

pub fn create_task(conn: &Connection, opts: CreateTaskOpts<'_>) -> rusqlite::Result<TaskRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let priority = opts.priority.unwrap_or(0);
    let tool: Option<&str> = opts.tool;

    conn.execute(
        "INSERT INTO tasks (id, project_id, title, prompt, tool, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
        params![id, opts.project_id, opts.title, opts.prompt, tool, priority, now, now],
    )?;

    Ok(TaskRow {
        id,
        project_id: opts.project_id.to_string(),
        title: opts.title.to_string(),
        prompt: opts.prompt.to_string(),
        tool: tool.map(|s| s.to_string()),
        status: "pending".to_string(),
        priority,
        branch_name: None,
        worktree_path: None,
        run_id: None,
        error_message: None,
        summary: None,
        created_at: now,
        updated_at: now,
        claimed_at: None,
        completed_at: None,
    })
}

pub fn find_task_by_id(conn: &Connection, task_id: &str) -> rusqlite::Result<Option<TaskRow>> {
    let mut stmt = conn.prepare("SELECT * FROM tasks WHERE id = ?")?;
    let mut rows = stmt.query_map(params![task_id], row_to_task)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_tasks_by_project_id(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_task)?;
    rows.collect()
}

pub fn find_pending_tasks_by_project_id(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks WHERE project_id = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_task)?;
    rows.collect()
}

pub fn find_pending_tasks_by_agent_id(
    conn: &Connection,
    agent_id: &str,
) -> rusqlite::Result<Vec<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT tasks.* FROM tasks
         JOIN projects ON tasks.project_id = projects.id
         WHERE projects.agent_id = ? AND tasks.status = 'pending'
         ORDER BY tasks.priority DESC, tasks.created_at ASC",
    )?;
    let rows = stmt.query_map(params![agent_id], row_to_task)?;
    rows.collect()
}

pub fn update_task_status(
    conn: &Connection,
    task_id: &str,
    status: &str,
    error_message: Option<Option<&str>>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    let mut sets = vec!["status = ?".to_string(), "updated_at = ?".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(status.to_string()), Box::new(now)];

    if status == "dispatched" {
        sets.push("claimed_at = ?".to_string());
        param_values.push(Box::new(now));
    }
    if status == "completed" || status == "failed" {
        sets.push("completed_at = ?".to_string());
        param_values.push(Box::new(now));
    }
    if let Some(err_msg) = error_message {
        sets.push("error_message = ?".to_string());
        param_values.push(Box::new(err_msg.map(|s| s.to_string())));
    }

    param_values.push(Box::new(task_id.to_string()));

    let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn update_task_run_info(
    conn: &Connection,
    task_id: &str,
    run_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET run_id = ?, updated_at = ? WHERE id = ?",
        params![run_id, now_ms(), task_id],
    )?;
    Ok(())
}

pub fn update_task_worktree_info(
    conn: &Connection,
    task_id: &str,
    branch_name: &str,
    worktree_path: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET branch_name = ?, worktree_path = ?, updated_at = ? WHERE id = ?",
        params![branch_name, worktree_path, now_ms(), task_id],
    )?;
    Ok(())
}

pub struct UpdateTaskPromptOpts<'a> {
    pub title: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub priority: Option<i64>,
}

pub fn update_task_prompt(
    conn: &Connection,
    task_id: &str,
    opts: UpdateTaskPromptOpts<'_>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    let mut sets = vec!["updated_at = ?".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(title) = opts.title {
        sets.push("title = ?".to_string());
        param_values.push(Box::new(title.to_string()));
    }
    if let Some(prompt) = opts.prompt {
        sets.push("prompt = ?".to_string());
        param_values.push(Box::new(prompt.to_string()));
    }
    if let Some(priority) = opts.priority {
        sets.push("priority = ?".to_string());
        param_values.push(Box::new(priority));
    }

    param_values.push(Box::new(task_id.to_string()));

    let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn delete_task(conn: &Connection, task_id: &str) -> rusqlite::Result<bool> {
    let changes = conn.execute("DELETE FROM tasks WHERE id = ?", params![task_id])?;
    Ok(changes > 0)
}

pub fn reset_task_to_pending(
    conn: &Connection,
    task_id: &str,
    additional_prompt: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_ms();

    // Clear previous execution data
    conn.execute(
        "DELETE FROM task_messages WHERE task_id = ?",
        params![task_id],
    )?;
    conn.execute(
        "DELETE FROM task_steps WHERE task_id = ?",
        params![task_id],
    )?;

    if let Some(extra) = additional_prompt {
        if let Some(existing) = find_task_by_id(conn, task_id)? {
            let new_prompt = format!("{}\n\n{}", existing.prompt, extra);
            conn.execute(
                "UPDATE tasks SET
                    status = 'pending',
                    prompt = ?,
                    run_id = NULL,
                    branch_name = NULL,
                    worktree_path = NULL,
                    error_message = NULL,
                    summary = NULL,
                    claimed_at = NULL,
                    completed_at = NULL,
                    updated_at = ?
                WHERE id = ?",
                params![new_prompt, now, task_id],
            )?;
            return Ok(());
        }
    }

    conn.execute(
        "UPDATE tasks SET
            status = 'pending',
            run_id = NULL,
            branch_name = NULL,
            worktree_path = NULL,
            error_message = NULL,
            summary = NULL,
            claimed_at = NULL,
            completed_at = NULL,
            updated_at = ?
        WHERE id = ?",
        params![now, task_id],
    )?;

    Ok(())
}

pub fn update_task_summary(
    conn: &Connection,
    task_id: &str,
    summary: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET summary = ?, updated_at = ? WHERE id = ?",
        params![summary, now_ms(), task_id],
    )?;
    Ok(())
}

// --- Task Steps ---

pub struct CreateTaskStepOpts<'a> {
    pub id: Option<&'a str>,
    pub task_id: &'a str,
    pub step_type: &'a str,
    pub label: &'a str,
    pub tool_name: &'a str,
    pub status: Option<&'a str>,
    pub detail: Option<&'a str>,
    pub run_id: Option<&'a str>,
    pub created_at: Option<i64>,
}

pub fn create_task_step(
    conn: &Connection,
    opts: CreateTaskStepOpts<'_>,
) -> rusqlite::Result<TaskStepRow> {
    let id = opts
        .id
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = opts.created_at.unwrap_or_else(now_ms);
    let status = opts.status.unwrap_or("running");

    conn.execute(
        "INSERT INTO task_steps (id, task_id, type, label, status, detail, tool_name, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, opts.task_id, opts.step_type, opts.label, status, opts.detail, opts.tool_name, opts.run_id, now],
    )?;

    Ok(TaskStepRow {
        id,
        task_id: opts.task_id.to_string(),
        step_type: opts.step_type.to_string(),
        label: opts.label.to_string(),
        status: status.to_string(),
        detail: opts.detail.map(|s| s.to_string()),
        tool_name: opts.tool_name.to_string(),
        run_id: opts.run_id.map(|s| s.to_string()),
        duration_ms: None,
        created_at: now,
        completed_at: None,
    })
}

pub struct UpdateTaskStepOpts<'a> {
    pub status: Option<&'a str>,
    pub detail: Option<&'a str>,
    pub run_id: Option<&'a str>,
    pub duration_ms: Option<i64>,
    pub completed_at: Option<i64>,
}

pub fn update_task_step(
    conn: &Connection,
    id: &str,
    opts: UpdateTaskStepOpts<'_>,
) -> rusqlite::Result<()> {
    let mut sets: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(status) = opts.status {
        sets.push("status = ?".to_string());
        param_values.push(Box::new(status.to_string()));
    }
    if let Some(detail) = opts.detail {
        sets.push("detail = ?".to_string());
        param_values.push(Box::new(detail.to_string()));
    }
    if let Some(run_id) = opts.run_id {
        sets.push("run_id = ?".to_string());
        param_values.push(Box::new(run_id.to_string()));
    }
    if let Some(duration_ms) = opts.duration_ms {
        sets.push("duration_ms = ?".to_string());
        param_values.push(Box::new(duration_ms));
    }
    if let Some(completed_at) = opts.completed_at {
        sets.push("completed_at = ?".to_string());
        param_values.push(Box::new(completed_at));
    }

    if sets.is_empty() {
        return Ok(());
    }

    param_values.push(Box::new(id.to_string()));

    let sql = format!("UPDATE task_steps SET {} WHERE id = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn find_steps_by_task_id(
    conn: &Connection,
    task_id: &str,
) -> rusqlite::Result<Vec<TaskStepRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM task_steps WHERE task_id = ? ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], row_to_task_step)?;
    rows.collect()
}

// --- Task Messages ---

pub fn create_task_message(
    conn: &Connection,
    task_id: &str,
    role: &str,
    content: &str,
    id: Option<&str>,
) -> rusqlite::Result<TaskMessageRow> {
    let msg_id = id
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = now_ms();
    conn.execute(
        "INSERT INTO task_messages (id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        params![msg_id, task_id, role, content, now],
    )?;
    Ok(TaskMessageRow {
        id: msg_id,
        task_id: task_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: now,
    })
}

pub fn find_messages_by_task_id(
    conn: &Connection,
    task_id: &str,
) -> rusqlite::Result<Vec<TaskMessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], row_to_task_message)?;
    rows.collect()
}

pub fn delete_last_task_messages(
    conn: &Connection,
    task_id: &str,
    count: usize,
) -> rusqlite::Result<usize> {
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM task_messages WHERE task_id = ?1 ORDER BY created_at DESC LIMIT ?2")?
        .query_map(params![task_id, count as i64], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for id in &ids {
        conn.execute("DELETE FROM task_messages WHERE id = ?1", params![id])?;
    }
    Ok(ids.len())
}

pub fn count_task_messages(
    conn: &Connection,
    task_id: &str,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM task_messages WHERE task_id = ?1",
        params![task_id],
        |row| row.get(0),
    )
}
