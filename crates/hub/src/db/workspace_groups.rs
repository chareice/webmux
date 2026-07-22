use rusqlite::{params, Connection};

use super::now_ms;
use super::types::WorkspaceGroupRow;

pub fn find_workspace_groups_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<WorkspaceGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, machine_id, name, sort_order, created_at
         FROM workspace_groups WHERE user_id = ?1
         ORDER BY machine_id ASC, sort_order ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![user_id], workspace_group_from_row)?;
    rows.collect()
}

pub fn find_workspace_groups_by_machine(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
) -> rusqlite::Result<Vec<WorkspaceGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, machine_id, name, sort_order, created_at
         FROM workspace_groups WHERE user_id = ?1 AND machine_id = ?2
         ORDER BY sort_order ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![user_id, machine_id], workspace_group_from_row)?;
    rows.collect()
}

pub fn workspace_group_belongs_to_machine(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_id: &str,
) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspace_groups
         WHERE id = ?1 AND user_id = ?2 AND machine_id = ?3",
        params![group_id, user_id, machine_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn create_workspace_group(
    conn: &Connection,
    id: &str,
    user_id: &str,
    machine_id: &str,
    name: &str,
    sort_order: i64,
) -> rusqlite::Result<WorkspaceGroupRow> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO workspace_groups (id, user_id, machine_id, name, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, user_id, machine_id, name, sort_order, created_at],
    )?;
    Ok(WorkspaceGroupRow {
        id: id.to_string(),
        user_id: user_id.to_string(),
        machine_id: machine_id.to_string(),
        name: name.to_string(),
        sort_order,
        created_at,
    })
}

pub fn update_workspace_group_sort_order(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_id: &str,
    sort_order: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workspace_groups SET sort_order = ?1
         WHERE id = ?2 AND user_id = ?3 AND machine_id = ?4",
        params![sort_order, group_id, user_id, machine_id],
    )
}

pub fn update_workspace_group_name(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_id: &str,
    name: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workspace_groups SET name = ?1
         WHERE id = ?2 AND user_id = ?3 AND machine_id = ?4",
        params![name, group_id, user_id, machine_id],
    )
}

pub fn delete_workspace_group(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_id: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM workspace_groups
         WHERE id = ?1 AND user_id = ?2 AND machine_id = ?3",
        params![group_id, user_id, machine_id],
    )
}

fn workspace_group_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceGroupRow> {
    Ok(WorkspaceGroupRow {
        id: row.get(0)?,
        user_id: row.get(1)?,
        machine_id: row.get(2)?,
        name: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
    })
}
