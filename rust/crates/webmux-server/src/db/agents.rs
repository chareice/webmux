use rusqlite::{Connection, params};
use uuid::Uuid;

use super::types::{AgentRow, RegistrationTokenRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_agent(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRow> {
    Ok(AgentRow {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        name: row.get("name")?,
        agent_secret_hash: row.get("agent_secret_hash")?,
        status: row.get("status")?,
        last_seen_at: row.get("last_seen_at")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_registration_token(row: &rusqlite::Row<'_>) -> rusqlite::Result<RegistrationTokenRow> {
    Ok(RegistrationTokenRow {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        agent_name: row.get("agent_name")?,
        token_hash: row.get("token_hash")?,
        expires_at: row.get("expires_at")?,
        used: row.get("used")?,
    })
}

// --- Agents ---

pub fn find_agents_by_user_id(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<AgentRow>> {
    let mut stmt = conn.prepare("SELECT * FROM agents WHERE user_id = ?")?;
    let rows = stmt.query_map(params![user_id], row_to_agent)?;
    rows.collect()
}

pub fn find_agent_by_id(
    conn: &Connection,
    agent_id: &str,
) -> rusqlite::Result<Option<AgentRow>> {
    let mut stmt = conn.prepare("SELECT * FROM agents WHERE id = ?")?;
    let mut rows = stmt.query_map(params![agent_id], row_to_agent)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub struct CreateAgentOpts<'a> {
    pub user_id: &'a str,
    pub name: &'a str,
    pub agent_secret_hash: &'a str,
}

pub fn create_agent(conn: &Connection, opts: CreateAgentOpts<'_>) -> rusqlite::Result<AgentRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();

    conn.execute(
        "INSERT INTO agents (id, user_id, name, agent_secret_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![id, opts.user_id, opts.name, opts.agent_secret_hash, "offline", now],
    )?;

    Ok(AgentRow {
        id,
        user_id: opts.user_id.to_string(),
        name: opts.name.to_string(),
        agent_secret_hash: opts.agent_secret_hash.to_string(),
        status: "offline".to_string(),
        last_seen_at: None,
        created_at: now,
    })
}

pub fn delete_agent(conn: &Connection, agent_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM agents WHERE id = ?", params![agent_id])?;
    Ok(())
}

pub fn rename_agent(conn: &Connection, agent_id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE agents SET name = ? WHERE id = ?",
        params![name, agent_id],
    )?;
    Ok(())
}

pub fn update_agent_status(
    conn: &Connection,
    agent_id: &str,
    status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE agents SET status = ? WHERE id = ?",
        params![status, agent_id],
    )?;
    Ok(())
}

pub fn update_agent_last_seen(conn: &Connection, agent_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE agents SET last_seen_at = ? WHERE id = ?",
        params![now_ms(), agent_id],
    )?;
    Ok(())
}

// --- Registration Tokens ---

pub struct CreateRegistrationTokenOpts<'a> {
    pub user_id: &'a str,
    pub agent_name: &'a str,
    pub token_hash: &'a str,
    pub expires_at: i64,
}

pub fn create_registration_token(
    conn: &Connection,
    opts: CreateRegistrationTokenOpts<'_>,
) -> rusqlite::Result<RegistrationTokenRow> {
    // Clean up expired and used tokens
    conn.execute(
        "DELETE FROM registration_tokens WHERE used = 1 OR expires_at < ?",
        params![now_ms()],
    )?;

    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO registration_tokens (id, user_id, agent_name, token_hash, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)",
        params![id, opts.user_id, opts.agent_name, opts.token_hash, opts.expires_at],
    )?;

    Ok(RegistrationTokenRow {
        id,
        user_id: opts.user_id.to_string(),
        agent_name: opts.agent_name.to_string(),
        token_hash: opts.token_hash.to_string(),
        expires_at: opts.expires_at,
        used: 0,
    })
}

pub fn consume_registration_token(
    conn: &Connection,
    token_hash: &str,
) -> rusqlite::Result<Option<RegistrationTokenRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM registration_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?",
    )?;
    let now = now_ms();
    let mut rows = stmt.query_map(params![token_hash, now], row_to_registration_token)?;

    let token = match rows.next() {
        Some(row) => row?,
        None => return Ok(None),
    };

    conn.execute(
        "UPDATE registration_tokens SET used = 1 WHERE id = ?",
        params![token.id],
    )?;

    Ok(Some(token))
}
