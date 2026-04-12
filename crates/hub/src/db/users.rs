use rusqlite::{params, Connection};

use super::now_ms;
use super::types::UserRow;

pub fn find_user_by_id(conn: &Connection, user_id: &str) -> rusqlite::Result<Option<UserRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, provider, provider_id, display_name, avatar_url, role, created_at
         FROM users WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![user_id], |row| {
        Ok(UserRow {
            id: row.get(0)?,
            provider: row.get(1)?,
            provider_id: row.get(2)?,
            display_name: row.get(3)?,
            avatar_url: row.get(4)?,
            role: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_user_by_provider(
    conn: &Connection,
    provider: &str,
    provider_id: &str,
) -> rusqlite::Result<Option<UserRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, provider, provider_id, display_name, avatar_url, role, created_at
         FROM users WHERE provider = ?1 AND provider_id = ?2",
    )?;
    let mut rows = stmt.query_map(params![provider, provider_id], |row| {
        Ok(UserRow {
            id: row.get(0)?,
            provider: row.get(1)?,
            provider_id: row.get(2)?,
            display_name: row.get(3)?,
            avatar_url: row.get(4)?,
            role: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn create_user(
    conn: &Connection,
    id: &str,
    provider: &str,
    provider_id: &str,
    display_name: &str,
    avatar_url: Option<&str>,
    role: &str,
) -> rusqlite::Result<UserRow> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO users (id, provider, provider_id, display_name, avatar_url, role, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            provider,
            provider_id,
            display_name,
            avatar_url,
            role,
            created_at
        ],
    )?;
    Ok(UserRow {
        id: id.to_string(),
        provider: provider.to_string(),
        provider_id: provider_id.to_string(),
        display_name: display_name.to_string(),
        avatar_url: avatar_url.map(|s| s.to_string()),
        role: role.to_string(),
        created_at,
    })
}

pub fn count_users(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
}
