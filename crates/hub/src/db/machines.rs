use rusqlite::{params, Connection};

use super::now_ms;
use super::types::MachineRow;

pub fn find_machine_by_id(
    conn: &Connection,
    machine_id: &str,
) -> rusqlite::Result<Option<MachineRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, machine_secret_hash, status, os, home_dir, last_seen_at, created_at
         FROM machines WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![machine_id], |row| {
        Ok(MachineRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            machine_secret_hash: row.get(3)?,
            status: row.get(4)?,
            os: row.get(5)?,
            home_dir: row.get(6)?,
            last_seen_at: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_machines_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<MachineRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, machine_secret_hash, status, os, home_dir, last_seen_at, created_at
         FROM machines WHERE user_id = ?1",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(MachineRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            machine_secret_hash: row.get(3)?,
            status: row.get(4)?,
            os: row.get(5)?,
            home_dir: row.get(6)?,
            last_seen_at: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn create_machine(
    conn: &Connection,
    id: &str,
    user_id: &str,
    name: &str,
    secret_hash: &str,
) -> rusqlite::Result<MachineRow> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at)
         VALUES (?1, ?2, ?3, ?4, 'offline', ?5)",
        params![id, user_id, name, secret_hash, created_at],
    )?;
    Ok(MachineRow {
        id: id.to_string(),
        user_id: user_id.to_string(),
        name: name.to_string(),
        machine_secret_hash: secret_hash.to_string(),
        status: "offline".to_string(),
        os: None,
        home_dir: None,
        last_seen_at: None,
        created_at,
    })
}

pub fn update_machine_status(
    conn: &Connection,
    machine_id: &str,
    status: &str,
) -> rusqlite::Result<()> {
    let last_seen_at = now_ms();
    conn.execute(
        "UPDATE machines SET status = ?1, last_seen_at = ?2 WHERE id = ?3",
        params![status, last_seen_at, machine_id],
    )?;
    Ok(())
}

pub fn update_machine_info(
    conn: &Connection,
    machine_id: &str,
    os: Option<&str>,
    home_dir: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE machines SET os = ?1, home_dir = ?2 WHERE id = ?3",
        params![os, home_dir, machine_id],
    )?;
    Ok(())
}

pub fn delete_machine(conn: &Connection, machine_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM machines WHERE id = ?1", params![machine_id])?;
    Ok(())
}
