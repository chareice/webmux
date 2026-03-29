use rusqlite::{Connection, params};

use super::types::ApiTokenRow;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_api_token(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApiTokenRow> {
    Ok(ApiTokenRow {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        name: row.get("name")?,
        token_hash: row.get("token_hash")?,
        created_at: row.get("created_at")?,
        last_used_at: row.get("last_used_at")?,
        expires_at: row.get("expires_at")?,
    })
}

pub fn create_api_token(
    conn: &Connection,
    id: &str,
    user_id: &str,
    name: &str,
    token_hash: &str,
    expires_at: Option<i64>,
) -> rusqlite::Result<ApiTokenRow> {
    let now = now_ms();

    conn.execute(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![id, user_id, name, token_hash, now, expires_at],
    )?;

    Ok(ApiTokenRow {
        id: id.to_string(),
        user_id: user_id.to_string(),
        name: name.to_string(),
        token_hash: token_hash.to_string(),
        created_at: now,
        last_used_at: None,
        expires_at,
    })
}

pub fn find_api_token_by_hash(
    conn: &Connection,
    token_hash: &str,
) -> rusqlite::Result<Option<ApiTokenRow>> {
    let mut stmt = conn.prepare("SELECT * FROM api_tokens WHERE token_hash = ?")?;
    let mut rows = stmt.query_map(params![token_hash], row_to_api_token)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_api_tokens_by_user_id(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<ApiTokenRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC")?;
    let rows = stmt.query_map(params![user_id], row_to_api_token)?;
    rows.collect()
}

pub fn update_api_token_last_used(
    conn: &Connection,
    token_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE api_tokens SET last_used_at = ? WHERE id = ?",
        params![now_ms(), token_id],
    )?;
    Ok(())
}

pub fn delete_api_token(
    conn: &Connection,
    token_id: &str,
    user_id: &str,
) -> rusqlite::Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM api_tokens WHERE id = ? AND user_id = ?",
        params![token_id, user_id],
    )?;
    Ok(deleted)
}
