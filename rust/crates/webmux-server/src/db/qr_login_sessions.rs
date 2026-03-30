use rusqlite::{Connection, params};
use uuid::Uuid;
use super::types::QrLoginSessionRow;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

const QR_SESSION_TTL_MS: i64 = 120_000; // 2 minutes

fn row_to_qr_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<QrLoginSessionRow> {
    Ok(QrLoginSessionRow {
        id: row.get("id")?,
        status: row.get("status")?,
        user_id: row.get("user_id")?,
        created_at: row.get("created_at")?,
        expires_at: row.get("expires_at")?,
    })
}

pub fn create_qr_session(conn: &Connection) -> rusqlite::Result<QrLoginSessionRow> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let expires_at = now + QR_SESSION_TTL_MS;

    conn.execute(
        "INSERT INTO qr_login_sessions (id, status, created_at, expires_at) VALUES (?, 'pending', ?, ?)",
        params![id, now, expires_at],
    )?;

    Ok(QrLoginSessionRow {
        id,
        status: "pending".to_string(),
        user_id: None,
        created_at: now,
        expires_at,
    })
}

pub fn find_qr_session(conn: &Connection, id: &str) -> rusqlite::Result<Option<QrLoginSessionRow>> {
    let mut stmt = conn.prepare("SELECT * FROM qr_login_sessions WHERE id = ?")?;
    let mut rows = stmt.query_map(params![id], row_to_qr_session)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn confirm_qr_session(conn: &Connection, id: &str, user_id: &str) -> rusqlite::Result<bool> {
    let updated = conn.execute(
        "UPDATE qr_login_sessions SET status = 'confirmed', user_id = ? WHERE id = ? AND status = 'pending'",
        params![user_id, id],
    )?;
    Ok(updated > 0)
}

pub fn cleanup_expired_sessions(conn: &Connection) -> rusqlite::Result<usize> {
    let now = now_ms();
    let deleted = conn.execute(
        "DELETE FROM qr_login_sessions WHERE expires_at < ?",
        params![now],
    )?;
    Ok(deleted)
}
