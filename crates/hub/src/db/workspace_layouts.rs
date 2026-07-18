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
        "SELECT user_id, machine_id, group_key, root_json, updated_at
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
        "SELECT user_id, machine_id, group_key, root_json, updated_at
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
        "SELECT user_id, machine_id, group_key, root_json, updated_at
         FROM workspace_layouts
         WHERE user_id = ?1 AND machine_id = ?2 AND group_key = ?3",
    )?;
    let mut rows = stmt.query_map(
        params![user_id, machine_id, group_key],
        workspace_layout_from_row,
    )?;
    rows.next().transpose()
}

pub fn upsert_workspace_layout(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
) -> rusqlite::Result<WorkspaceLayoutRow> {
    let now = now_ms();
    let updated_at = find_workspace_layout(conn, user_id, machine_id, group_key)?
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, updated_at],
    )?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        updated_at,
    })
}

pub fn upsert_workspace_layout_checked(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
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
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, updated_at],
    )?;
    tx.commit()?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        updated_at,
    })
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
    tx.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, updated_at],
    )?;
    tx.commit()?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.to_string(),
        machine_id: machine_id.to_string(),
        group_key: group_key.to_string(),
        root_json: root_json.to_string(),
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
        updated_at: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tc_protocol::{WorkspaceLayoutNode, WorkspaceSplitDirection};

    use super::{find_workspace_layouts_by_machine, upsert_workspace_layout};

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
        assert_eq!(rows[0].root_json, "null");
    }

    #[test]
    fn legacy_scrollable_layout_migrates_column_order_to_split_tree() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE workspace_layouts (
                user_id TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                group_key TEXT NOT NULL,
                root_json TEXT NOT NULL,
                layout_mode TEXT,
                aux_json TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, machine_id, group_key)
            );
            INSERT INTO workspace_layouts (
                user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at
            ) VALUES (
                'u1', 'm1', 'g1', 'null', 'scrollable',
                '{"columns":[{"terminalId":"a","width":{"kind":"preset","value":"half"}},{"terminalId":"b","width":{"kind":"preset","value":"full"}},{"terminalId":"c","width":{"kind":"fraction","value":0.7}}]}',
                1234
            );
            "#,
        )
        .unwrap();

        crate::db::init_db(&conn).unwrap();

        let row = find_workspace_layouts_by_machine(&conn, "u1", "m1")
            .unwrap()
            .remove(0);
        let root: Option<WorkspaceLayoutNode> = serde_json::from_str(&row.root_json).unwrap();
        assert_eq!(
            root,
            Some(WorkspaceLayoutNode::Split {
                direction: WorkspaceSplitDirection::Horizontal,
                ratio: 0.5,
                first: Box::new(WorkspaceLayoutNode::Leaf {
                    terminal_id: "a".to_string(),
                }),
                second: Box::new(WorkspaceLayoutNode::Split {
                    direction: WorkspaceSplitDirection::Horizontal,
                    ratio: 0.5,
                    first: Box::new(WorkspaceLayoutNode::Leaf {
                        terminal_id: "b".to_string(),
                    }),
                    second: Box::new(WorkspaceLayoutNode::Leaf {
                        terminal_id: "c".to_string(),
                    }),
                }),
            })
        );
        let legacy_fields: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT layout_mode, aux_json FROM workspace_layouts WHERE group_key = 'g1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(legacy_fields, (None, None));
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
