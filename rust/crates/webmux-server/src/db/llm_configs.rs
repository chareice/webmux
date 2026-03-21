use rusqlite::{Connection, params};
use uuid::Uuid;

use super::types::LlmConfigRow;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_llm_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<LlmConfigRow> {
    Ok(LlmConfigRow {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        project_id: row.get("project_id")?,
        api_base_url: row.get("api_base_url")?,
        api_key: row.get("api_key")?,
        model: row.get("model")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub struct CreateLlmConfigData<'a> {
    pub api_base_url: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
    pub project_id: Option<&'a str>,
}

pub fn create_llm_config(
    conn: &Connection,
    user_id: &str,
    data: CreateLlmConfigData<'_>,
) -> rusqlite::Result<LlmConfigRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();

    conn.execute(
        "INSERT INTO llm_configs (id, user_id, project_id, api_base_url, api_key, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, user_id, data.project_id, data.api_base_url, data.api_key, data.model, now, now],
    )?;

    Ok(LlmConfigRow {
        id,
        user_id: user_id.to_string(),
        project_id: data.project_id.map(|s| s.to_string()),
        api_base_url: data.api_base_url.to_string(),
        api_key: data.api_key.to_string(),
        model: data.model.to_string(),
        created_at: now,
        updated_at: now,
    })
}

pub fn find_llm_configs_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<LlmConfigRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM llm_configs WHERE user_id = ? ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![user_id], row_to_llm_config)?;
    rows.collect()
}

pub fn find_llm_config_by_id(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<Option<LlmConfigRow>> {
    let mut stmt = conn.prepare("SELECT * FROM llm_configs WHERE id = ?")?;
    let mut rows = stmt.query_map(params![id], row_to_llm_config)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn resolve_llm_config(
    conn: &Connection,
    user_id: &str,
    project_id: Option<&str>,
) -> rusqlite::Result<Option<LlmConfigRow>> {
    // Try project-specific config first
    if let Some(pid) = project_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM llm_configs WHERE user_id = ? AND project_id = ?",
        )?;
        let mut rows = stmt.query_map(params![user_id, pid], row_to_llm_config)?;
        if let Some(row) = rows.next() {
            return Ok(Some(row?));
        }
    }

    // Fall back to default config (project_id IS NULL)
    let mut stmt = conn.prepare(
        "SELECT * FROM llm_configs WHERE user_id = ? AND project_id IS NULL",
    )?;
    let mut rows = stmt.query_map(params![user_id], row_to_llm_config)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Optional fields for update. `project_id` uses double-Option:
/// `None` means don't update, `Some(None)` means set to NULL, `Some(Some(v))` means set value.
pub struct UpdateLlmConfigData<'a> {
    pub api_base_url: Option<&'a str>,
    pub api_key: Option<&'a str>,
    pub model: Option<&'a str>,
    pub project_id: Option<Option<&'a str>>,
}

pub fn update_llm_config(
    conn: &Connection,
    id: &str,
    data: UpdateLlmConfigData<'_>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    let mut sets = vec!["updated_at = ?".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(api_base_url) = data.api_base_url {
        sets.push("api_base_url = ?".to_string());
        param_values.push(Box::new(api_base_url.to_string()));
    }
    if let Some(api_key) = data.api_key {
        sets.push("api_key = ?".to_string());
        param_values.push(Box::new(api_key.to_string()));
    }
    if let Some(model) = data.model {
        sets.push("model = ?".to_string());
        param_values.push(Box::new(model.to_string()));
    }
    if let Some(project_id) = data.project_id {
        sets.push("project_id = ?".to_string());
        param_values.push(Box::new(project_id.map(|s| s.to_string())));
    }

    param_values.push(Box::new(id.to_string()));

    let sql = format!("UPDATE llm_configs SET {} WHERE id = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn delete_llm_config(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM llm_configs WHERE id = ?", params![id])?;
    Ok(())
}
