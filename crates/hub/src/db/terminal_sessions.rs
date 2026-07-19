use rusqlite::{params, Connection};
use tc_protocol::TerminalTitleSource;

use super::now_ms;
use super::types::TerminalSessionRow;

#[derive(Debug, PartialEq, Eq)]
pub enum TitleUpdateOutcome {
    Updated,
    Unchanged,
    Rejected,
}

fn title_source_name(source: TerminalTitleSource) -> &'static str {
    match source {
        TerminalTitleSource::Osc => "osc",
        TerminalTitleSource::Process => "process",
    }
}

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
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
             machine_id = excluded.machine_id,
             title = excluded.title,
             cwd = excluded.cwd,
             cols = excluded.cols,
             rows = excluded.rows",
        params![
            id,
            machine_id,
            title,
            cwd,
            cols as i64,
            rows as i64,
            created_at
        ],
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

pub fn apply_title_update(
    conn: &Connection,
    id: &str,
    title: &str,
    source: TerminalTitleSource,
) -> rusqlite::Result<TitleUpdateOutcome> {
    let current = conn.query_row(
        "SELECT title, title_source FROM terminal_sessions WHERE id = ?1 AND destroyed_at IS NULL",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    );
    let (current_title, current_source) = match current {
        Ok(current) => current,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(TitleUpdateOutcome::Rejected),
        Err(error) => return Err(error),
    };
    let next_source = title_source_name(source);
    if current_source == "osc" && source == TerminalTitleSource::Process {
        return Ok(TitleUpdateOutcome::Rejected);
    }
    if current_title == title && current_source == next_source {
        return Ok(TitleUpdateOutcome::Unchanged);
    }
    conn.execute(
        "UPDATE terminal_sessions SET title = ?1, title_source = ?2 WHERE id = ?3",
        params![title, next_source, id],
    )?;
    Ok(TitleUpdateOutcome::Updated)
}

pub fn assign_workspace_group(
    conn: &Connection,
    id: &str,
    workspace_group_id: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE terminal_sessions SET workspace_group_id = ?1 WHERE id = ?2",
        params![workspace_group_id, id],
    )?;
    Ok(())
}

pub fn clear_workspace_group(conn: &Connection, workspace_group_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE terminal_sessions SET workspace_group_id = NULL WHERE workspace_group_id = ?1",
        params![workspace_group_id],
    )?;
    Ok(())
}

pub fn find_active_by_machine(
    conn: &Connection,
    machine_id: &str,
) -> rusqlite::Result<Vec<TerminalSessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, machine_id, title, title_source, cwd, workspace_group_id, cols, rows, created_at, destroyed_at
         FROM terminal_sessions WHERE machine_id = ?1 AND destroyed_at IS NULL
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![machine_id], |row| {
        Ok(TerminalSessionRow {
            id: row.get(0)?,
            machine_id: row.get(1)?,
            title: row.get(2)?,
            title_source: row.get(3)?,
            cwd: row.get(4)?,
            workspace_group_id: row.get(5)?,
            cols: row.get(6)?,
            rows: row.get(7)?,
            created_at: row.get(8)?,
            destroyed_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn find_all_active(conn: &Connection) -> rusqlite::Result<Vec<TerminalSessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, machine_id, title, title_source, cwd, workspace_group_id, cols, rows, created_at, destroyed_at
         FROM terminal_sessions WHERE destroyed_at IS NULL
         ORDER BY machine_id ASC, created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TerminalSessionRow {
            id: row.get(0)?,
            machine_id: row.get(1)?,
            title: row.get(2)?,
            title_source: row.get(3)?,
            cwd: row.get(4)?,
            workspace_group_id: row.get(5)?,
            cols: row.get(6)?,
            rows: row.get(7)?,
            created_at: row.get(8)?,
            destroyed_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};
    use tc_protocol::TerminalTitleSource;

    use super::{apply_title_update, find_active_by_machine, find_all_active, TitleUpdateOutcome};

    fn insert_session(conn: &Connection, id: &str, created_at: i64) {
        conn.execute(
            "INSERT INTO terminal_sessions
                (id, machine_id, title, cwd, cols, rows, created_at)
             VALUES (?1, 'machine-a', ?2, '/tmp', 80, 24, ?3)",
            params![id, format!("Terminal {id}"), created_at],
        )
        .unwrap();
    }

    #[test]
    fn active_sessions_are_returned_in_stable_creation_order() {
        let conn = Connection::open_in_memory().unwrap();
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

        insert_session(&conn, "late", 200);
        insert_session(&conn, "same-b", 100);
        insert_session(&conn, "same-a", 100);

        let machine_ids: Vec<String> = find_active_by_machine(&conn, "machine-a")
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        assert_eq!(machine_ids, ["same-a", "same-b", "late"]);

        let all_ids: Vec<String> = find_all_active(&conn)
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        assert_eq!(all_ids, ["same-a", "same-b", "late"]);
    }

    #[test]
    fn process_title_never_overwrites_an_osc_title() {
        let conn = Connection::open_in_memory().unwrap();
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
        insert_session(&conn, "term-a", 100);

        assert_eq!(
            apply_title_update(&conn, "term-a", "editor", TerminalTitleSource::Osc).unwrap(),
            TitleUpdateOutcome::Updated
        );
        assert_eq!(
            apply_title_update(
                &conn,
                "term-a",
                "foreground-process",
                TerminalTitleSource::Process,
            )
            .unwrap(),
            TitleUpdateOutcome::Rejected
        );

        let row = find_active_by_machine(&conn, "machine-a")
            .unwrap()
            .remove(0);
        assert_eq!(row.title, "editor");
        assert_eq!(row.title_source, "osc");
    }
}
