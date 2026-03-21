use rusqlite::{Connection, params};
use uuid::Uuid;

use super::types::{ProjectRow, ProjectActionRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        agent_id: row.get("agent_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        repo_path: row.get("repo_path")?,
        default_tool: row.get("default_tool")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_project_action(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectActionRow> {
    Ok(ProjectActionRow {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        prompt: row.get("prompt")?,
        tool: row.get("tool")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// --- Projects ---

pub struct CreateProjectOpts<'a> {
    pub user_id: &'a str,
    pub agent_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub repo_path: &'a str,
    pub default_tool: Option<&'a str>,
}

pub fn create_project(
    conn: &Connection,
    opts: CreateProjectOpts<'_>,
) -> rusqlite::Result<ProjectRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let description = opts.description.unwrap_or("");
    let default_tool = opts.default_tool.unwrap_or("claude");

    conn.execute(
        "INSERT INTO projects (id, user_id, agent_id, name, description, repo_path, default_tool, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, opts.user_id, opts.agent_id, opts.name, description, opts.repo_path, default_tool, now, now],
    )?;

    Ok(ProjectRow {
        id,
        user_id: opts.user_id.to_string(),
        agent_id: opts.agent_id.to_string(),
        name: opts.name.to_string(),
        description: description.to_string(),
        repo_path: opts.repo_path.to_string(),
        default_tool: default_tool.to_string(),
        created_at: now,
        updated_at: now,
    })
}

pub fn find_project_by_id(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Option<ProjectRow>> {
    let mut stmt = conn.prepare("SELECT * FROM projects WHERE id = ?")?;
    let mut rows = stmt.query_map(params![project_id], row_to_project)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_projects_by_user_id(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<ProjectRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC")?;
    let rows = stmt.query_map(params![user_id], row_to_project)?;
    rows.collect()
}

pub fn find_projects_by_agent_id(
    conn: &Connection,
    agent_id: &str,
) -> rusqlite::Result<Vec<ProjectRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM projects WHERE agent_id = ? ORDER BY updated_at DESC")?;
    let rows = stmt.query_map(params![agent_id], row_to_project)?;
    rows.collect()
}

pub struct UpdateProjectOpts<'a> {
    pub name: Option<&'a str>,
    pub description: Option<&'a str>,
    pub default_tool: Option<&'a str>,
}

pub fn update_project(
    conn: &Connection,
    project_id: &str,
    opts: UpdateProjectOpts<'_>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    let mut sets = vec!["updated_at = ?".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(name) = opts.name {
        sets.push("name = ?".to_string());
        param_values.push(Box::new(name.to_string()));
    }
    if let Some(description) = opts.description {
        sets.push("description = ?".to_string());
        param_values.push(Box::new(description.to_string()));
    }
    if let Some(default_tool) = opts.default_tool {
        sets.push("default_tool = ?".to_string());
        param_values.push(Box::new(default_tool.to_string()));
    }

    param_values.push(Box::new(project_id.to_string()));

    let sql = format!("UPDATE projects SET {} WHERE id = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn delete_project(conn: &Connection, project_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?", params![project_id])?;
    Ok(())
}

// --- Project Actions ---

pub struct CreateProjectActionOpts<'a> {
    pub project_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub prompt: &'a str,
    pub tool: Option<&'a str>,
    pub sort_order: Option<i64>,
}

pub fn create_project_action(
    conn: &Connection,
    opts: CreateProjectActionOpts<'_>,
) -> rusqlite::Result<ProjectActionRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let description = opts.description.unwrap_or("");
    let tool = opts.tool.unwrap_or("claude");
    let sort_order = opts.sort_order.unwrap_or(0);

    conn.execute(
        "INSERT INTO project_actions (id, project_id, name, description, prompt, tool, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, opts.project_id, opts.name, description, opts.prompt, tool, sort_order, now, now],
    )?;

    Ok(ProjectActionRow {
        id,
        project_id: opts.project_id.to_string(),
        name: opts.name.to_string(),
        description: description.to_string(),
        prompt: opts.prompt.to_string(),
        tool: tool.to_string(),
        sort_order,
        created_at: now,
        updated_at: now,
    })
}

pub fn find_project_action_by_id(
    conn: &Connection,
    action_id: &str,
) -> rusqlite::Result<Option<ProjectActionRow>> {
    let mut stmt = conn.prepare("SELECT * FROM project_actions WHERE id = ?")?;
    let mut rows = stmt.query_map(params![action_id], row_to_project_action)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_project_actions_by_project_id(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectActionRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM project_actions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_project_action)?;
    rows.collect()
}

pub struct UpdateProjectActionOpts<'a> {
    pub name: Option<&'a str>,
    pub description: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub tool: Option<&'a str>,
    pub sort_order: Option<i64>,
}

pub fn update_project_action(
    conn: &Connection,
    action_id: &str,
    opts: UpdateProjectActionOpts<'_>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    let mut sets = vec!["updated_at = ?".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(name) = opts.name {
        sets.push("name = ?".to_string());
        param_values.push(Box::new(name.to_string()));
    }
    if let Some(description) = opts.description {
        sets.push("description = ?".to_string());
        param_values.push(Box::new(description.to_string()));
    }
    if let Some(prompt) = opts.prompt {
        sets.push("prompt = ?".to_string());
        param_values.push(Box::new(prompt.to_string()));
    }
    if let Some(tool) = opts.tool {
        sets.push("tool = ?".to_string());
        param_values.push(Box::new(tool.to_string()));
    }
    if let Some(sort_order) = opts.sort_order {
        sets.push("sort_order = ?".to_string());
        param_values.push(Box::new(sort_order));
    }

    param_values.push(Box::new(action_id.to_string()));

    let sql = format!(
        "UPDATE project_actions SET {} WHERE id = ?",
        sets.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn delete_project_action(conn: &Connection, action_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM project_actions WHERE id = ?",
        params![action_id],
    )?;
    Ok(())
}
