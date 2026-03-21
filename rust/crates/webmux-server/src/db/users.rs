use rusqlite::{Connection, params};
use uuid::Uuid;

use super::types::UserRow;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        id: row.get("id")?,
        provider: row.get("provider")?,
        provider_id: row.get("provider_id")?,
        display_name: row.get("display_name")?,
        avatar_url: row.get("avatar_url")?,
        role: row.get("role")?,
        created_at: row.get("created_at")?,
    })
}

pub fn find_user_by_provider(
    conn: &Connection,
    provider: &str,
    provider_id: &str,
) -> rusqlite::Result<Option<UserRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM users WHERE provider = ? AND provider_id = ?")?;
    let mut rows = stmt.query_map(params![provider, provider_id], row_to_user)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_user_by_id(conn: &Connection, user_id: &str) -> rusqlite::Result<Option<UserRow>> {
    let mut stmt = conn.prepare("SELECT * FROM users WHERE id = ?")?;
    let mut rows = stmt.query_map(params![user_id], row_to_user)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub struct CreateUserOpts<'a> {
    pub provider: &'a str,
    pub provider_id: &'a str,
    pub display_name: &'a str,
    pub avatar_url: Option<&'a str>,
    pub role: Option<&'a str>,
}

pub fn create_user(conn: &Connection, opts: CreateUserOpts<'_>) -> rusqlite::Result<UserRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let role = opts.role.unwrap_or("user");

    conn.execute(
        "INSERT INTO users (id, provider, provider_id, display_name, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![id, opts.provider, opts.provider_id, opts.display_name, opts.avatar_url, role, now],
    )?;

    Ok(UserRow {
        id,
        provider: opts.provider.to_string(),
        provider_id: opts.provider_id.to_string(),
        display_name: opts.display_name.to_string(),
        avatar_url: opts.avatar_url.map(|s| s.to_string()),
        role: role.to_string(),
        created_at: now,
    })
}

pub fn count_users(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) as cnt FROM users", [], |row| row.get(0))
}
