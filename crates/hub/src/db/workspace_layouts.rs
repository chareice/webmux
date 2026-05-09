use rusqlite::{params, Connection, TransactionBehavior};

use super::now_ms;
use super::types::WorkspaceLayoutRow;

#[derive(Debug)]
pub enum WorkspaceLayoutSaveError {
    Conflict,
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for WorkspaceLayoutSaveError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Db(error)
    }
}

pub fn find_workspace_layouts_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<WorkspaceLayoutRow>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at
         FROM workspace_layouts WHERE user_id = ?1
         ORDER BY machine_id ASC, group_key ASC",
    )?;
    let rows = stmt.query_map(params![user_id], workspace_layout_from_row)?;
    rows.collect()
}

pub fn find_workspace_layouts_by_machine(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
) -> rusqlite::Result<Vec<WorkspaceLayoutRow>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at
         FROM workspace_layouts WHERE user_id = ?1 AND machine_id = ?2
         ORDER BY group_key ASC",
    )?;
    let rows = stmt.query_map(params![user_id, machine_id], workspace_layout_from_row)?;
    rows.collect()
}

pub fn find_workspace_layout(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
) -> rusqlite::Result<Option<WorkspaceLayoutRow>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at
         FROM workspace_layouts
         WHERE user_id = ?1 AND machine_id = ?2 AND group_key = ?3",
    )?;
    let mut rows = stmt.query_map(
        params![user_id, machine_id, group_key],
        workspace_layout_from_row,
    )?;
    rows.next().transpose()
}

pub fn upsert_workspace_layout_full(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
    layout_mode: Option<&str>,
    aux_json: Option<&str>,
) -> rusqlite::Result<WorkspaceLayoutRow> {
    let now = now_ms();
    let updated_at = find_workspace_layout(conn, user_id, machine_id, group_key)?
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             layout_mode = excluded.layout_mode,
             aux_json = excluded.aux_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at],
    )?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        layout_mode: layout_mode.map(str::to_string),
        aux_json: aux_json.map(str::to_string),
        updated_at,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_workspace_layout_full_checked(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
    layout_mode: Option<&str>,
    aux_json: Option<&str>,
    base_updated_at: i64,
) -> Result<WorkspaceLayoutRow, WorkspaceLayoutSaveError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = find_workspace_layout(&tx, user_id, machine_id, group_key)?;
    if workspace_layout_base_conflicts(existing.as_ref().map(|row| row.updated_at), base_updated_at)
    {
        return Err(WorkspaceLayoutSaveError::Conflict);
    }
    let now = now_ms();
    let updated_at = existing
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    tx.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             layout_mode = excluded.layout_mode,
             aux_json = excluded.aux_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at],
    )?;
    tx.commit()?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        layout_mode: layout_mode.map(str::to_string),
        aux_json: aux_json.map(str::to_string),
        updated_at,
    })
}

pub fn upsert_workspace_layout(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
) -> rusqlite::Result<WorkspaceLayoutRow> {
    upsert_workspace_layout_full(conn, user_id, machine_id, group_key, root_json, None, None)
}

pub fn upsert_workspace_layout_checked(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
    base_updated_at: i64,
) -> Result<WorkspaceLayoutRow, WorkspaceLayoutSaveError> {
    upsert_workspace_layout_full_checked(
        conn,
        user_id,
        machine_id,
        group_key,
        root_json,
        None,
        None,
        base_updated_at,
    )
}

pub fn delete_workspace_layout(
    conn: &Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM workspace_layouts
         WHERE user_id = ?1 AND machine_id = ?2 AND group_key = ?3",
        params![user_id, machine_id, group_key],
    )
}

pub fn delete_workspace_layout_checked(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    base_updated_at: i64,
) -> Result<WorkspaceLayoutRow, WorkspaceLayoutSaveError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = find_workspace_layout(&tx, user_id, machine_id, group_key)?;
    if workspace_layout_base_conflicts(existing.as_ref().map(|row| row.updated_at), base_updated_at)
    {
        return Err(WorkspaceLayoutSaveError::Conflict);
    }
    let now = now_ms();
    let updated_at = existing
        .as_ref()
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    let root_json = "null";
    // Preserve the previous mode so consumers branching on it after a delete
    // still see the layout's most recent kind. aux_json stays NULL because the
    // scrollable payload (if any) was specific to the deleted layout's content.
    let layout_mode = existing.as_ref().and_then(|row| row.layout_mode.clone());
    let aux_json: Option<&str> = None;
    tx.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             layout_mode = excluded.layout_mode,
             aux_json = excluded.aux_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, layout_mode.as_deref(), aux_json, updated_at],
    )?;
    tx.commit()?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.to_string(),
        machine_id: machine_id.to_string(),
        group_key: group_key.to_string(),
        root_json: root_json.to_string(),
        layout_mode,
        aux_json: None,
        updated_at,
    })
}

fn workspace_layout_base_conflicts(existing_updated_at: Option<i64>, base_updated_at: i64) -> bool {
    if base_updated_at < 0 {
        return existing_updated_at.is_some();
    }
    existing_updated_at
        .map(|updated_at| updated_at > base_updated_at)
        .unwrap_or(true)
}

fn workspace_layout_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceLayoutRow> {
    Ok(WorkspaceLayoutRow {
        user_id: row.get(0)?,
        machine_id: row.get(1)?,
        group_key: row.get(2)?,
        root_json: row.get(3)?,
        layout_mode: row.get(4)?,
        aux_json: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tc_protocol::{WorkspaceLayoutNode, WorkspaceSplitDirection};

    use super::{
        find_workspace_layouts_by_machine, upsert_workspace_layout, upsert_workspace_layout_full,
    };

    #[test]
    fn upsert_round_trips_mode_and_aux() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "u1", "test", "u1", "U", None, "admin").unwrap();
        crate::db::machines::ensure_machine_for_user(&conn, "m1", "u1", "M", None, None).unwrap();
        upsert_workspace_layout_full(
            &mut conn,
            "u1",
            "m1",
            "g1",
            "null",
            Some("scrollable"),
            Some(r#"{"columns":[]}"#),
        )
        .unwrap();
        let rows = find_workspace_layouts_by_machine(&conn, "u1", "m1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].layout_mode.as_deref(), Some("scrollable"));
        assert_eq!(rows[0].aux_json.as_deref(), Some(r#"{"columns":[]}"#));
    }

    #[test]
    fn legacy_workspace_layout_rows_backfill_to_tiling() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "u1", "test", "u1", "U", None, "admin").unwrap();
        crate::db::machines::ensure_machine_for_user(&conn, "m1", "u1", "M", None, None).unwrap();
        // Simulate a row written by an earlier version (before mode/aux columns existed)
        conn.execute(
            "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, updated_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params!["u1","m1","cwd:/x","null", 1234i64],
        ).unwrap();
        let rows = find_workspace_layouts_by_machine(&conn, "u1", "m1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].layout_mode.as_deref(), None); // NULL means legacy / tiling
        assert!(rows[0].aux_json.is_none());
    }

    #[test]
    fn upsert_round_trips_workspace_layout_json() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "user-a", "test", "user-a", "User A", None, "admin")
            .unwrap();
        crate::db::machines::ensure_machine_for_user(
            &conn,
            "machine-a",
            "user-a",
            "Machine A",
            Some("linux"),
            Some("/tmp"),
        )
        .unwrap();

        let root = Some(WorkspaceLayoutNode::Split {
            direction: WorkspaceSplitDirection::Horizontal,
            ratio: 0.5,
            first: Box::new(WorkspaceLayoutNode::Leaf {
                terminal_id: "a".to_string(),
            }),
            second: Box::new(WorkspaceLayoutNode::Leaf {
                terminal_id: "b".to_string(),
            }),
        });
        let root_json = serde_json::to_string(&root).unwrap();

        upsert_workspace_layout(&mut conn, "user-a", "machine-a", "cwd:/repo", &root_json).unwrap();
        let rows = find_workspace_layouts_by_machine(&conn, "user-a", "machine-a").unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "cwd:/repo");
        let decoded: Option<WorkspaceLayoutNode> =
            serde_json::from_str(&rows[0].root_json).unwrap();
        assert_eq!(decoded, root);
    }
}
