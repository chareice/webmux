use rusqlite::{params, Connection};

use super::now_ms;
use super::types::BookmarkRow;

pub fn find_bookmarks_by_machine(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
) -> rusqlite::Result<Vec<BookmarkRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, machine_id, path, label, sort_order, created_at
         FROM bookmarks WHERE user_id = ?1 AND machine_id = ?2
         ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map(params![user_id, machine_id], |row| {
        Ok(BookmarkRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            machine_id: row.get(2)?,
            path: row.get(3)?,
            label: row.get(4)?,
            sort_order: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn create_bookmark(
    conn: &Connection,
    id: &str,
    user_id: &str,
    machine_id: &str,
    path: &str,
    label: &str,
    sort_order: i64,
) -> rusqlite::Result<BookmarkRow> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO bookmarks (id, user_id, machine_id, path, label, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, user_id, machine_id, path, label, sort_order, created_at],
    )?;
    Ok(BookmarkRow {
        id: id.to_string(),
        user_id: user_id.to_string(),
        machine_id: machine_id.to_string(),
        path: path.to_string(),
        label: label.to_string(),
        sort_order,
        created_at,
    })
}

pub fn delete_bookmark(
    conn: &Connection,
    bookmark_id: &str,
    user_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM bookmarks WHERE id = ?1 AND user_id = ?2",
        params![bookmark_id, user_id],
    )?;
    Ok(())
}
