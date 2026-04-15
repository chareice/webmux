use rusqlite::{params, Connection};

use super::now_ms;
use super::types::TerminalSessionRow;

pub fn insert(
    conn: &Connection,
    id: &str,
    machine_id: &str,
    title: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> rusqlite::Result<()> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO terminal_sessions (id, machine_id, title, cwd, cols, rows, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, machine_id, title, cwd, cols as i64, rows as i64, created_at],
    )?;
    Ok(())
}

pub fn mark_destroyed(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let destroyed_at = now_ms();
    conn.execute(
        "UPDATE terminal_sessions SET destroyed_at = ?1 WHERE id = ?2 AND destroyed_at IS NULL",
        params![destroyed_at, id],
    )?;
    Ok(())
}

pub fn update_size(conn: &Connection, id: &str, cols: u16, rows: u16) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE terminal_sessions SET cols = ?1, rows = ?2 WHERE id = ?3",
        params![cols as i64, rows as i64, id],
    )?;
    Ok(())
}

pub fn update_metadata(
    conn: &Connection,
    id: &str,
    title: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE terminal_sessions SET title = ?1, cwd = ?2, cols = ?3, rows = ?4 WHERE id = ?5",
        params![title, cwd, cols as i64, rows as i64, id],
    )?;
    Ok(())
}

pub fn find_active_by_machine(
    conn: &Connection,
    machine_id: &str,
) -> rusqlite::Result<Vec<TerminalSessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, machine_id, title, cwd, cols, rows, created_at, destroyed_at
         FROM terminal_sessions WHERE machine_id = ?1 AND destroyed_at IS NULL",
    )?;
    let rows = stmt.query_map(params![machine_id], |row| {
        Ok(TerminalSessionRow {
            id: row.get(0)?,
            machine_id: row.get(1)?,
            title: row.get(2)?,
            cwd: row.get(3)?,
            cols: row.get(4)?,
            rows: row.get(5)?,
            created_at: row.get(6)?,
            destroyed_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn find_all_active(conn: &Connection) -> rusqlite::Result<Vec<TerminalSessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, machine_id, title, cwd, cols, rows, created_at, destroyed_at
         FROM terminal_sessions WHERE destroyed_at IS NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TerminalSessionRow {
            id: row.get(0)?,
            machine_id: row.get(1)?,
            title: row.get(2)?,
            cwd: row.get(3)?,
            cols: row.get(4)?,
            rows: row.get(5)?,
            created_at: row.get(6)?,
            destroyed_at: row.get(7)?,
        })
    })?;
    rows.collect()
}
