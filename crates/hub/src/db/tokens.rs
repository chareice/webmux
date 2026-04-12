use rusqlite::{params, Connection};

use super::now_ms;
use super::types::{ApiTokenRow, RegistrationTokenRow};

pub fn create_registration_token(
    conn: &Connection,
    id: &str,
    user_id: &str,
    machine_name: &str,
    token_hash: &str,
    expires_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO registration_tokens (id, user_id, machine_name, token_hash, expires_at, used)
         VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![id, user_id, machine_name, token_hash, expires_at],
    )?;
    Ok(())
}

pub fn find_registration_token_by_hash(
    conn: &Connection,
    token_hash: &str,
) -> rusqlite::Result<Option<RegistrationTokenRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, machine_name, token_hash, expires_at, used
         FROM registration_tokens WHERE token_hash = ?1",
    )?;
    let mut rows = stmt.query_map(params![token_hash], |row| {
        Ok(RegistrationTokenRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            machine_name: row.get(2)?,
            token_hash: row.get(3)?,
            expires_at: row.get(4)?,
            used: row.get::<_, i64>(5)? != 0,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn consume_registration_token(conn: &Connection, token_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE registration_tokens SET used = 1 WHERE id = ?1",
        params![token_id],
    )?;
    Ok(())
}

pub fn cleanup_expired_tokens(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "DELETE FROM registration_tokens WHERE expires_at < ?1 OR used = 1",
        params![now],
    )?;
    Ok(())
}

pub fn create_api_token(
    conn: &Connection,
    id: &str,
    user_id: &str,
    name: &str,
    token_hash: &str,
    expires_at: Option<i64>,
) -> rusqlite::Result<()> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, user_id, name, token_hash, created_at, expires_at],
    )?;
    Ok(())
}

pub fn find_api_token_by_hash(
    conn: &Connection,
    token_hash: &str,
) -> rusqlite::Result<Option<ApiTokenRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, token_hash, created_at, last_used_at, expires_at
         FROM api_tokens WHERE token_hash = ?1",
    )?;
    let mut rows = stmt.query_map(params![token_hash], |row| {
        Ok(ApiTokenRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            token_hash: row.get(3)?,
            created_at: row.get(4)?,
            last_used_at: row.get(5)?,
            expires_at: row.get(6)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn list_api_tokens_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<ApiTokenRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, token_hash, created_at, last_used_at, expires_at
         FROM api_tokens WHERE user_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(ApiTokenRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            token_hash: row.get(3)?,
            created_at: row.get(4)?,
            last_used_at: row.get(5)?,
            expires_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn delete_api_token(conn: &Connection, token_id: &str, user_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM api_tokens WHERE id = ?1 AND user_id = ?2",
        params![token_id, user_id],
    )?;
    Ok(())
}

pub fn update_api_token_last_used(conn: &Connection, token_id: &str) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2",
        params![now, token_id],
    )?;
    Ok(())
}
