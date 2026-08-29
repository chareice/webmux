use std::collections::HashMap;

use rusqlite::{params, Connection};
use tc_protocol::{AgentKind, AgentSessionInfo, AgentSessionStatus};

use super::now_ms;
use super::types::AgentSessionRow;

/// Events kept per session; older rows are trimmed on insert.
const EVENT_HISTORY_PER_SESSION: i64 = 5000;

pub fn kind_name(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Grok => "grok",
        AgentKind::Kimi => "kimi",
    }
}

pub fn kind_from_name(name: &str) -> AgentKind {
    match name {
        "codex" => AgentKind::Codex,
        "grok" => AgentKind::Grok,
        "kimi" => AgentKind::Kimi,
        _ => AgentKind::Claude,
    }
}

pub fn status_name(status: AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Starting => "starting",
        AgentSessionStatus::Working => "working",
        AgentSessionStatus::Asked => "asked",
        AgentSessionStatus::Idle => "idle",
        AgentSessionStatus::Error => "error",
        AgentSessionStatus::Disconnected => "disconnected",
    }
}

/// Inverse of `status_name` for hydrating rows. Unknown values fall back to
/// Error rather than failing the whole query.
pub fn status_from_name(name: &str) -> AgentSessionStatus {
    match name {
        "starting" => AgentSessionStatus::Starting,
        "working" => AgentSessionStatus::Working,
        "asked" => AgentSessionStatus::Asked,
        "idle" => AgentSessionStatus::Idle,
        "disconnected" => AgentSessionStatus::Disconnected,
        _ => AgentSessionStatus::Error,
    }
}

pub fn row_to_info(row: &AgentSessionRow) -> AgentSessionInfo {
    AgentSessionInfo {
        id: row.id.clone(),
        machine_id: row.machine_id.clone(),
        agent_kind: kind_from_name(&row.agent_kind),
        cwd: row.cwd.clone(),
        title: row.title.clone(),
        status: status_from_name(&row.status),
        auto_run: row.auto_run,
        acp_session_id: row.acp_session_id.clone(),
        workspace_group_id: row.workspace_group_id.clone(),
        last_event_seq: row.last_event_seq.max(0) as u64,
        created_at_ms: row.created_at,
    }
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<AgentSessionRow> {
    Ok(AgentSessionRow {
        id: row.get(0)?,
        user_id: row.get(1)?,
        machine_id: row.get(2)?,
        agent_kind: row.get(3)?,
        cwd: row.get(4)?,
        title: row.get(5)?,
        status: row.get(6)?,
        auto_run: row.get::<_, i64>(7)? != 0,
        acp_session_id: row.get(8)?,
        workspace_group_id: row.get(9)?,
        last_event_seq: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

const COLUMNS: &str = "id, user_id, machine_id, agent_kind, cwd, title, status, auto_run, \
     acp_session_id, workspace_group_id, last_event_seq, created_at, updated_at";

#[allow(clippy::too_many_arguments)]
pub fn insert_session(
    conn: &Connection,
    id: &str,
    user_id: &str,
    machine_id: &str,
    agent_kind: AgentKind,
    cwd: &str,
    title: &str,
    status: AgentSessionStatus,
    auto_run: bool,
    workspace_group_id: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO agent_sessions
            (id, user_id, machine_id, agent_kind, cwd, title, status, auto_run,
             workspace_group_id, last_event_seq, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)",
        params![
            id,
            user_id,
            machine_id,
            kind_name(agent_kind),
            cwd,
            title,
            status_name(status),
            auto_run as i64,
            workspace_group_id,
            now
        ],
    )?;
    Ok(())
}

pub fn find_session(conn: &Connection, id: &str) -> rusqlite::Result<Option<AgentSessionRow>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM agent_sessions WHERE id = ?1"))?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_sessions_by_user(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<AgentSessionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM agent_sessions WHERE user_id = ?1 ORDER BY created_at ASC, id ASC"
    ))?;
    let rows = stmt.query_map(params![user_id], map_row)?;
    rows.collect()
}

/// Apply a machine-reported update; fields left `None` are unchanged.
pub fn apply_update(
    conn: &Connection,
    id: &str,
    status: Option<AgentSessionStatus>,
    title: Option<&str>,
    acp_session_id: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    if let Some(status) = status {
        conn.execute(
            "UPDATE agent_sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status_name(status), now, id],
        )?;
    }
    if let Some(title) = title {
        conn.execute(
            "UPDATE agent_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )?;
    }
    if let Some(acp_session_id) = acp_session_id {
        conn.execute(
            "UPDATE agent_sessions SET acp_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![acp_session_id, now, id],
        )?;
    }
    Ok(())
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: AgentSessionStatus,
) -> rusqlite::Result<()> {
    apply_update(conn, id, Some(status), None, None)
}

/// A machine-assigned event seq is only ever interesting if it advances the
/// stored watermark (a resumed session restarts its seq at 1).
pub fn bump_last_event_seq(conn: &Connection, id: &str, seq: u64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE agent_sessions SET last_event_seq = MAX(last_event_seq, ?1), updated_at = ?2
         WHERE id = ?3",
        params![seq as i64, now_ms(), id],
    )?;
    Ok(())
}

pub fn last_event_seq(conn: &Connection, id: &str) -> rusqlite::Result<Option<u64>> {
    let row = conn.query_row(
        "SELECT last_event_seq FROM agent_sessions WHERE id = ?1",
        params![id],
        |row| row.get::<_, i64>(0),
    );
    match row {
        Ok(seq) => Ok(Some(seq.max(0) as u64)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Deletes the session together with its events and seen markers.
pub fn delete_session(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM agent_session_events WHERE session_id = ?1",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM agent_session_seen WHERE session_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM agent_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

/// Mark every still-live session of a machine Disconnected; returns the
/// affected rows (post-update) so the caller can broadcast each change.
pub fn mark_machine_sessions_disconnected(
    conn: &Connection,
    machine_id: &str,
) -> rusqlite::Result<Vec<AgentSessionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM agent_sessions
         WHERE machine_id = ?1 AND status IN ('starting', 'working', 'asked', 'idle')"
    ))?;
    let rows = stmt
        .query_map(params![machine_id], map_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.is_empty() {
        return Ok(rows);
    }
    conn.execute(
        "UPDATE agent_sessions SET status = 'disconnected', updated_at = ?1
         WHERE machine_id = ?2 AND status IN ('starting', 'working', 'asked', 'idle')",
        params![now_ms(), machine_id],
    )?;
    Ok(rows
        .into_iter()
        .map(|row| AgentSessionRow {
            status: "disconnected".to_string(),
            ..row
        })
        .collect())
}

pub fn insert_event(
    conn: &Connection,
    session_id: &str,
    seq: u64,
    event_json: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO agent_session_events (session_id, seq, event_json, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![session_id, seq as i64, event_json, now_ms()],
    )?;
    // Trim to the newest EVENT_HISTORY_PER_SESSION rows for this session.
    conn.execute(
        "DELETE FROM agent_session_events
         WHERE session_id = ?1 AND seq <= (
             SELECT MAX(seq) FROM agent_session_events WHERE session_id = ?1
         ) - ?2",
        params![session_id, EVENT_HISTORY_PER_SESSION],
    )?;
    Ok(())
}

/// One page of the session's event log: (seq, event_json) pairs with
/// seq > from_seq, oldest first.
pub fn events_page(
    conn: &Connection,
    session_id: &str,
    from_seq: u64,
    limit: u64,
) -> rusqlite::Result<Vec<(u64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT seq, event_json FROM agent_session_events
         WHERE session_id = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![session_id, from_seq as i64, limit as i64], |row| {
        Ok((row.get::<_, i64>(0)?.max(0) as u64, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// Advance the user's read cursor, monotonically (never decreases); returns
/// the effective cursor after the upsert.
pub fn upsert_seen(
    conn: &Connection,
    user_id: &str,
    session_id: &str,
    last_seen_seq: u64,
) -> rusqlite::Result<u64> {
    conn.execute(
        "INSERT INTO agent_session_seen (user_id, session_id, last_seen_seq)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, session_id) DO UPDATE SET
             last_seen_seq = MAX(last_seen_seq, excluded.last_seen_seq)",
        params![user_id, session_id, last_seen_seq as i64],
    )?;
    let seq = conn.query_row(
        "SELECT last_seen_seq FROM agent_session_seen WHERE user_id = ?1 AND session_id = ?2",
        params![user_id, session_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(seq.max(0) as u64)
}

pub fn seen_by_user(conn: &Connection, user_id: &str) -> rusqlite::Result<HashMap<String, u64>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, last_seen_seq FROM agent_session_seen WHERE user_id = ?1",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?.max(0) as u64,
        ))
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    fn test_db() -> Connection {
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
        conn
    }

    fn insert_test_session(conn: &Connection, id: &str) {
        insert_session(
            conn,
            id,
            "user-a",
            "machine-a",
            AgentKind::Kimi,
            "/work/repo",
            "repo",
            AgentSessionStatus::Starting,
            true,
            None,
        )
        .unwrap();
    }

    #[test]
    fn session_round_trips_through_insert_and_find() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");

        let row = find_session(&conn, "s-1").unwrap().unwrap();
        assert_eq!(row.user_id, "user-a");
        assert_eq!(row.agent_kind, "kimi");
        assert_eq!(row.status, "starting");
        assert!(row.auto_run);
        assert_eq!(row.last_event_seq, 0);

        let info = row_to_info(&row);
        assert_eq!(info.agent_kind, AgentKind::Kimi);
        assert_eq!(info.status, AgentSessionStatus::Starting);
        assert_eq!(info.title, "repo");

        assert!(find_session(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn apply_update_touches_only_given_fields() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");

        apply_update(
            &conn,
            "s-1",
            Some(AgentSessionStatus::Working),
            None,
            Some("acp-9"),
        )
        .unwrap();
        let row = find_session(&conn, "s-1").unwrap().unwrap();
        assert_eq!(row.status, "working");
        assert_eq!(row.acp_session_id.as_deref(), Some("acp-9"));
        assert_eq!(row.title, "repo", "untouched fields stay");
    }

    #[test]
    fn last_event_seq_never_moves_backwards() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");

        bump_last_event_seq(&conn, "s-1", 5).unwrap();
        bump_last_event_seq(&conn, "s-1", 3).unwrap();
        assert_eq!(last_event_seq(&conn, "s-1").unwrap(), Some(5));
    }

    #[test]
    fn events_page_returns_ordered_events_after_from_seq() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");
        for seq in 1..=5 {
            insert_event(&conn, "s-1", seq, &format!("{{\"seq\":{seq}}}")).unwrap();
        }

        let page = events_page(&conn, "s-1", 2, 2).unwrap();
        assert_eq!(
            page,
            vec![(3, "{\"seq\":3}".to_string()), (4, "{\"seq\":4}".to_string())]
        );

        // Re-inserting an existing seq is a no-op (INSERT OR IGNORE).
        insert_event(&conn, "s-1", 3, "{\"changed\":true}").unwrap();
        let page = events_page(&conn, "s-1", 2, 10).unwrap();
        assert_eq!(page[0].1, "{\"seq\":3}");
    }

    #[test]
    fn events_trim_to_the_newest_5000() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");
        for seq in 1..=5001 {
            insert_event(&conn, "s-1", seq, "{}").unwrap();
        }
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_session_events WHERE session_id = 's-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 5000);
        let page = events_page(&conn, "s-1", 0, 1).unwrap();
        assert_eq!(page[0].0, 2, "the oldest row was trimmed");
    }

    #[test]
    fn seen_is_monotonic_per_user() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");

        assert_eq!(upsert_seen(&conn, "user-a", "s-1", 7).unwrap(), 7);
        assert_eq!(
            upsert_seen(&conn, "user-a", "s-1", 3).unwrap(),
            7,
            "a lower cursor never regresses the stored one"
        );

        let seen = seen_by_user(&conn, "user-a").unwrap();
        assert_eq!(seen.get("s-1"), Some(&7));
    }

    #[test]
    fn disconnect_marks_only_live_sessions() {
        let conn = test_db();
        insert_test_session(&conn, "s-live");
        insert_test_session(&conn, "s-error");
        set_status(&conn, "s-error", AgentSessionStatus::Error).unwrap();

        let changed = mark_machine_sessions_disconnected(&conn, "machine-a").unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].id, "s-live");
        assert_eq!(changed[0].status, "disconnected");

        assert_eq!(
            find_session(&conn, "s-live").unwrap().unwrap().status,
            "disconnected"
        );
        assert_eq!(
            find_session(&conn, "s-error").unwrap().unwrap().status,
            "error",
            "already-terminal sessions are untouched"
        );
    }

    #[test]
    fn delete_session_removes_events_and_seen_rows() {
        let conn = test_db();
        insert_test_session(&conn, "s-1");
        insert_event(&conn, "s-1", 1, "{}").unwrap();
        upsert_seen(&conn, "user-a", "s-1", 1).unwrap();

        delete_session(&conn, "s-1").unwrap();
        assert!(find_session(&conn, "s-1").unwrap().is_none());
        assert!(events_page(&conn, "s-1", 0, 10).unwrap().is_empty());
        assert!(seen_by_user(&conn, "user-a").unwrap().is_empty());
    }
}
