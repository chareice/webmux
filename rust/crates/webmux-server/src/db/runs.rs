use rusqlite::{Connection, params};
use webmux_shared::{RunImageAttachment, RunImageAttachmentUpload, RunTimelineEvent, RunTimelineEventPayload, RunTurn, RunTurnDetail};

use super::types::{RunRow, RunTurnRow, RunTurnAttachmentRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRow> {
    Ok(RunRow {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        user_id: row.get("user_id")?,
        tool: row.get("tool")?,
        tool_thread_id: row.get("tool_thread_id")?,
        repo_path: row.get("repo_path")?,
        branch: row.get("branch")?,
        prompt: row.get("prompt")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        summary: row.get("summary")?,
        has_diff: row.get("has_diff")?,
        unread: row.get("unread")?,
    })
}

fn row_to_run_turn(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunTurnRow> {
    Ok(RunTurnRow {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        turn_index: row.get("turn_index")?,
        prompt: row.get("prompt")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        summary: row.get("summary")?,
        has_diff: row.get("has_diff")?,
    })
}

fn row_to_run_turn_attachment(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunTurnAttachmentRow> {
    Ok(RunTurnAttachmentRow {
        id: row.get("id")?,
        turn_id: row.get("turn_id")?,
        name: row.get("name")?,
        mime_type: row.get("mime_type")?,
        size_bytes: row.get("size_bytes")?,
    })
}

// --- Run CRUD ---

pub struct CreateRunOpts<'a> {
    pub id: &'a str,
    pub agent_id: &'a str,
    pub user_id: &'a str,
    pub tool: &'a str,
    pub tool_thread_id: Option<&'a str>,
    pub repo_path: &'a str,
    pub prompt: &'a str,
    pub branch: Option<&'a str>,
}

pub fn create_run(conn: &Connection, opts: CreateRunOpts<'_>) -> rusqlite::Result<RunRow> {
    let now = now_ms();
    let branch = opts.branch.unwrap_or("");

    conn.execute(
        "INSERT INTO runs (id, agent_id, user_id, tool, tool_thread_id, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, NULL, 0, 1)",
        params![
            opts.id,
            opts.agent_id,
            opts.user_id,
            opts.tool,
            opts.tool_thread_id,
            opts.repo_path,
            branch,
            opts.prompt,
            now,
            now
        ],
    )?;

    Ok(RunRow {
        id: opts.id.to_string(),
        agent_id: opts.agent_id.to_string(),
        user_id: opts.user_id.to_string(),
        tool: opts.tool.to_string(),
        tool_thread_id: opts.tool_thread_id.map(|value| value.to_string()),
        repo_path: opts.repo_path.to_string(),
        branch: branch.to_string(),
        prompt: opts.prompt.to_string(),
        status: "starting".to_string(),
        created_at: now,
        updated_at: now,
        summary: None,
        has_diff: 0,
        unread: 1,
    })
}

pub struct CreateRunWithInitialTurnOpts<'a> {
    pub run_id: &'a str,
    pub turn_id: &'a str,
    pub agent_id: &'a str,
    pub user_id: &'a str,
    pub tool: &'a str,
    pub repo_path: &'a str,
    pub prompt: &'a str,
    pub branch: Option<&'a str>,
    pub tool_thread_id: Option<&'a str>,
    pub attachments: Option<&'a [RunImageAttachmentUpload]>,
}

pub fn create_run_with_initial_turn(
    conn: &Connection,
    opts: CreateRunWithInitialTurnOpts<'_>,
) -> rusqlite::Result<(RunRow, RunTurnRow)> {
    let run = create_run(
        conn,
        CreateRunOpts {
            id: opts.run_id,
            agent_id: opts.agent_id,
            user_id: opts.user_id,
            tool: opts.tool,
            tool_thread_id: opts.tool_thread_id,
            repo_path: opts.repo_path,
            prompt: opts.prompt,
            branch: opts.branch,
        },
    )?;
    let turn = create_run_turn(
        conn,
        CreateRunTurnOpts {
            id: opts.turn_id,
            run_id: opts.run_id,
            prompt: opts.prompt,
            attachments: opts.attachments,
        },
    )?;
    Ok((run, turn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_run_persists_imported_session_id() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        conn.execute(
            "INSERT INTO users (id, provider, provider_id, display_name, role, created_at)
             VALUES ('user-1', 'dev', 'user-1', 'User', 'user', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (id, user_id, name, agent_secret_hash, status, created_at)
             VALUES ('agent-1', 'user-1', 'Agent', 'hash', 'online', 0)",
            [],
        )
        .unwrap();

        let run = create_run(
            &conn,
            CreateRunOpts {
                id: "run-1",
                agent_id: "agent-1",
                user_id: "user-1",
                tool: "codex",
                tool_thread_id: Some("existing-session"),
                repo_path: "/repo",
                prompt: "Continue from existing session",
                branch: None,
            },
        )
        .unwrap();

        assert_eq!(run.tool_thread_id.as_deref(), Some("existing-session"));

        let persisted = find_run_by_id(&conn, "run-1").unwrap().unwrap();
        assert_eq!(
            persisted.tool_thread_id.as_deref(),
            Some("existing-session")
        );
    }
}

pub fn find_run_by_id(conn: &Connection, run_id: &str) -> rusqlite::Result<Option<RunRow>> {
    let mut stmt = conn.prepare("SELECT * FROM runs WHERE id = ?")?;
    let mut rows = stmt.query_map(params![run_id], row_to_run)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_run_turn_by_id(
    conn: &Connection,
    turn_id: &str,
) -> rusqlite::Result<Option<RunTurnRow>> {
    let mut stmt = conn.prepare("SELECT * FROM run_turns WHERE id = ?")?;
    let mut rows = stmt.query_map(params![turn_id], row_to_run_turn)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_runs_by_agent_id(
    conn: &Connection,
    agent_id: &str,
) -> rusqlite::Result<Vec<RunRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM runs WHERE agent_id = ? ORDER BY created_at DESC")?;
    let rows = stmt.query_map(params![agent_id], row_to_run)?;
    rows.collect()
}

pub fn find_runs_by_user_id(conn: &Connection, user_id: &str) -> rusqlite::Result<Vec<RunRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC")?;
    let rows = stmt.query_map(params![user_id], row_to_run)?;
    rows.collect()
}

pub fn find_active_runs_by_agent_id(
    conn: &Connection,
    agent_id: &str,
) -> rusqlite::Result<Vec<RunRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM runs
         WHERE agent_id = ?
           AND status IN ('starting', 'running')
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![agent_id], row_to_run)?;
    rows.collect()
}

pub fn find_run_turns_by_run_id(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Vec<RunTurnRow>> {
    let mut stmt =
        conn.prepare("SELECT * FROM run_turns WHERE run_id = ? ORDER BY turn_index ASC")?;
    let rows = stmt.query_map(params![run_id], row_to_run_turn)?;
    rows.collect()
}

pub fn find_latest_run_turn_by_run_id(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Option<RunTurnRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM run_turns WHERE run_id = ? ORDER BY turn_index DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![run_id], row_to_run_turn)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_active_run_turn_by_run_id(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Option<RunTurnRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM run_turns
         WHERE run_id = ?
           AND status IN ('starting', 'running')
         ORDER BY turn_index DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![run_id], row_to_run_turn)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

// --- Run Turn CRUD ---

pub struct CreateRunTurnOpts<'a> {
    pub id: &'a str,
    pub run_id: &'a str,
    pub prompt: &'a str,
    pub attachments: Option<&'a [RunImageAttachmentUpload]>,
}

pub fn create_run_turn(
    conn: &Connection,
    opts: CreateRunTurnOpts<'_>,
) -> rusqlite::Result<RunTurnRow> {
    let now = now_ms();
    let latest = find_latest_run_turn_by_run_id(conn, opts.run_id)?;
    let turn_index = latest.map_or(1, |t| t.turn_index + 1);

    conn.execute(
        "INSERT INTO run_turns (
            id,
            run_id,
            turn_index,
            prompt,
            status,
            created_at,
            updated_at,
            summary,
            has_diff
        ) VALUES (?, ?, ?, ?, 'starting', ?, ?, NULL, 0)",
        params![opts.id, opts.run_id, turn_index, opts.prompt, now, now],
    )?;

    conn.execute(
        "UPDATE runs SET status = ?, summary = NULL, unread = 1, updated_at = ? WHERE id = ?",
        params!["starting", now, opts.run_id],
    )?;

    if let Some(attachments) = opts.attachments {
        if !attachments.is_empty() {
            create_run_turn_attachments(conn, opts.id, attachments)?;
        }
    }

    Ok(RunTurnRow {
        id: opts.id.to_string(),
        run_id: opts.run_id.to_string(),
        turn_index,
        prompt: opts.prompt.to_string(),
        status: "starting".to_string(),
        created_at: now,
        updated_at: now,
        summary: None,
        has_diff: 0,
    })
}

fn create_run_turn_attachments(
    conn: &Connection,
    turn_id: &str,
    attachments: &[RunImageAttachmentUpload],
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO run_turn_attachments (
            id,
            turn_id,
            name,
            mime_type,
            size_bytes,
            data
        ) VALUES (?, ?, ?, ?, ?, ?)",
    )?;

    for attachment in attachments {
        stmt.execute(params![
            attachment.id,
            turn_id,
            attachment.name,
            attachment.mime_type,
            attachment.size_bytes,
            attachment.base64,
        ])?;
    }

    Ok(())
}

pub fn update_run_status(
    conn: &Connection,
    run_id: &str,
    status: &str,
    summary: Option<&str>,
    has_diff: Option<bool>,
) -> rusqlite::Result<()> {
    let now = now_ms();
    match (summary, has_diff) {
        (Some(s), Some(d)) => {
            conn.execute(
                "UPDATE runs SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?",
                params![status, s, if d { 1 } else { 0 }, now, run_id],
            )?;
        }
        (Some(s), None) => {
            conn.execute(
                "UPDATE runs SET status = ?, summary = ?, unread = 1, updated_at = ? WHERE id = ?",
                params![status, s, now, run_id],
            )?;
        }
        (None, Some(d)) => {
            conn.execute(
                "UPDATE runs SET status = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?",
                params![status, if d { 1 } else { 0 }, now, run_id],
            )?;
        }
        (None, None) => {
            conn.execute(
                "UPDATE runs SET status = ?, unread = 1, updated_at = ? WHERE id = ?",
                params![status, now, run_id],
            )?;
        }
    }
    Ok(())
}

pub fn update_run_tool_thread_id(
    conn: &Connection,
    run_id: &str,
    tool_thread_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE runs SET tool_thread_id = ?, updated_at = ? WHERE id = ?",
        params![tool_thread_id, now_ms(), run_id],
    )?;
    Ok(())
}

pub fn update_run_turn_status(
    conn: &Connection,
    turn_id: &str,
    status: &str,
    summary: Option<&str>,
    has_diff: Option<bool>,
) -> rusqlite::Result<()> {
    let existing_turn = match find_run_turn_by_id(conn, turn_id)? {
        Some(t) => t,
        None => return Ok(()),
    };

    let now = now_ms();
    let next_summary: Option<String> = if summary.is_some() {
        summary.map(|s| s.to_string())
    } else {
        existing_turn.summary.clone()
    };
    let next_has_diff = match has_diff {
        Some(d) => {
            if d {
                1
            } else {
                0
            }
        }
        None => existing_turn.has_diff,
    };

    conn.execute(
        "UPDATE run_turns SET status = ?, summary = ?, has_diff = ?, updated_at = ? WHERE id = ?",
        params![status, next_summary, next_has_diff, now, turn_id],
    )?;

    conn.execute(
        "UPDATE runs SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?",
        params![status, next_summary, next_has_diff, now, existing_turn.run_id],
    )?;

    Ok(())
}

// --- Run Timeline Events ---

pub fn append_run_timeline_event(
    conn: &Connection,
    run_id: &str,
    turn_id: &str,
    event: &RunTimelineEventPayload,
) -> rusqlite::Result<RunTimelineEvent> {
    let now = now_ms();
    let event_type = match event {
        RunTimelineEventPayload::Message { .. } => "message",
        RunTimelineEventPayload::Command { .. } => "command",
        RunTimelineEventPayload::Activity { .. } => "activity",
        RunTimelineEventPayload::Todo { .. } => "todo",
    };
    let payload_json = serde_json::to_string(event).unwrap_or_default();

    conn.execute(
        "INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
        params![run_id, turn_id, event_type, payload_json, now],
    )?;
    let event_id = conn.last_insert_rowid();

    conn.execute(
        "UPDATE runs SET unread = 1, updated_at = ? WHERE id = ?",
        params![now, run_id],
    )?;
    conn.execute(
        "UPDATE run_turns SET updated_at = ? WHERE id = ?",
        params![now, turn_id],
    )?;

    Ok(RunTimelineEvent {
        id: event_id,
        created_at: now as f64,
        payload: event.clone(),
    })
}

pub fn find_run_timeline_events_by_turn(
    conn: &Connection,
    turn_id: &str,
) -> rusqlite::Result<Vec<RunTimelineEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, payload_json, created_at FROM run_events WHERE turn_id = ? ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![turn_id], |row| {
        let id: i64 = row.get("id")?;
        let payload_json: String = row.get("payload_json")?;
        let created_at: i64 = row.get("created_at")?;
        Ok((id, payload_json, created_at))
    })?;

    let mut events = Vec::new();
    for row in rows {
        let (id, payload_json, created_at) = row?;
        let payload: RunTimelineEventPayload =
            serde_json::from_str(&payload_json).unwrap_or(RunTimelineEventPayload::Activity {
                status: webmux_shared::RunTimelineEventStatus::Error,
                label: "Failed to parse event".to_string(),
                detail: Some(payload_json),
            });
        events.push(RunTimelineEvent {
            id,
            created_at: created_at as f64,
            payload,
        });
    }
    Ok(events)
}

/// Convert a RunTurnRow + attachments into the shared RunTurn type.
pub fn run_turn_row_to_run_turn(
    row: &RunTurnRow,
    attachments: Vec<RunImageAttachment>,
) -> RunTurn {
    RunTurn {
        id: row.id.clone(),
        run_id: row.run_id.clone(),
        index: row.turn_index,
        prompt: row.prompt.clone(),
        attachments,
        status: serde_json::from_str(&format!("\"{}\"", row.status))
            .unwrap_or(webmux_shared::RunStatus::Failed),
        created_at: row.created_at as f64,
        updated_at: row.updated_at as f64,
        summary: row.summary.clone(),
        has_diff: row.has_diff == 1,
    }
}

pub fn find_run_turn_details(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Vec<RunTurnDetail>> {
    let turns = find_run_turns_by_run_id(conn, run_id)?;
    if turns.is_empty() {
        return Ok(Vec::new());
    }

    // Fetch all events for this run
    let mut event_stmt = conn.prepare(
        "SELECT id, turn_id, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY id ASC",
    )?;
    let event_rows = event_stmt.query_map(params![run_id], |row| {
        let id: i64 = row.get("id")?;
        let turn_id: String = row.get("turn_id")?;
        let payload_json: String = row.get("payload_json")?;
        let created_at: i64 = row.get("created_at")?;
        Ok((id, turn_id, payload_json, created_at))
    })?;

    let mut items_by_turn_id: std::collections::HashMap<String, Vec<RunTimelineEvent>> =
        std::collections::HashMap::new();
    for row in event_rows {
        let (id, turn_id, payload_json, created_at) = row?;
        let payload: RunTimelineEventPayload =
            serde_json::from_str(&payload_json).unwrap_or(RunTimelineEventPayload::Activity {
                status: webmux_shared::RunTimelineEventStatus::Error,
                label: "Failed to parse event".to_string(),
                detail: Some(payload_json),
            });
        items_by_turn_id
            .entry(turn_id)
            .or_default()
            .push(RunTimelineEvent {
                id,
                created_at: created_at as f64,
                payload,
            });
    }

    // Fetch all attachments for turns in this run
    let mut attachment_stmt = conn.prepare(
        "SELECT id, turn_id, name, mime_type, size_bytes
         FROM run_turn_attachments
         WHERE turn_id IN (
             SELECT id FROM run_turns WHERE run_id = ?
         )
         ORDER BY rowid ASC",
    )?;
    let attachment_rows =
        attachment_stmt.query_map(params![run_id], row_to_run_turn_attachment)?;

    let mut attachments_by_turn_id: std::collections::HashMap<String, Vec<RunImageAttachment>> =
        std::collections::HashMap::new();
    for row in attachment_rows {
        let att_row = row?;
        attachments_by_turn_id
            .entry(att_row.turn_id.clone())
            .or_default()
            .push(RunImageAttachment {
                id: att_row.id,
                name: att_row.name,
                mime_type: att_row.mime_type,
                size_bytes: att_row.size_bytes as u64,
            });
    }

    let result = turns
        .iter()
        .map(|turn| {
            let attachments = attachments_by_turn_id
                .remove(&turn.id)
                .unwrap_or_default();
            let items = items_by_turn_id.remove(&turn.id).unwrap_or_default();
            let run_turn = run_turn_row_to_run_turn(turn, attachments);
            RunTurnDetail {
                id: run_turn.id,
                run_id: run_turn.run_id,
                index: run_turn.index,
                prompt: run_turn.prompt,
                attachments: run_turn.attachments,
                status: run_turn.status,
                created_at: run_turn.created_at,
                updated_at: run_turn.updated_at,
                summary: run_turn.summary,
                has_diff: run_turn.has_diff,
                items,
            }
        })
        .collect();

    Ok(result)
}

pub fn mark_run_read(conn: &Connection, run_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE runs SET unread = 0 WHERE id = ?",
        params![run_id],
    )?;
    Ok(())
}

pub fn delete_run(conn: &Connection, run_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM runs WHERE id = ?", params![run_id])?;
    Ok(())
}

pub fn delete_run_turn(conn: &Connection, turn_id: &str) -> rusqlite::Result<()> {
    let turn = match find_run_turn_by_id(conn, turn_id)? {
        Some(t) => t,
        None => return Ok(()),
    };

    conn.execute("DELETE FROM run_turns WHERE id = ?", params![turn_id])?;

    let latest_remaining = find_latest_run_turn_by_run_id(conn, &turn.run_id)?;

    match latest_remaining {
        None => {
            conn.execute("DELETE FROM runs WHERE id = ?", params![turn.run_id])?;
        }
        Some(latest) => {
            conn.execute(
                "UPDATE runs
                 SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ?
                 WHERE id = ?",
                params![
                    latest.status,
                    latest.summary,
                    latest.has_diff,
                    latest.updated_at,
                    turn.run_id,
                ],
            )?;
        }
    }

    Ok(())
}

// --- Queued turns ---

pub struct CreateQueuedRunTurnOpts<'a> {
    pub id: &'a str,
    pub run_id: &'a str,
    pub prompt: &'a str,
    pub attachments: Option<&'a [RunImageAttachmentUpload]>,
}

pub fn create_queued_run_turn(
    conn: &Connection,
    opts: CreateQueuedRunTurnOpts<'_>,
) -> rusqlite::Result<RunTurnRow> {
    let now = now_ms();
    let latest = find_latest_run_turn_by_run_id(conn, opts.run_id)?;
    let turn_index = latest.map_or(1, |t| t.turn_index + 1);

    conn.execute(
        "INSERT INTO run_turns (
            id, run_id, turn_index, prompt, status, created_at, updated_at, summary, has_diff
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, 0)",
        params![opts.id, opts.run_id, turn_index, opts.prompt, now, now],
    )?;

    if let Some(attachments) = opts.attachments {
        if !attachments.is_empty() {
            create_run_turn_attachments(conn, opts.id, attachments)?;
        }
    }

    Ok(RunTurnRow {
        id: opts.id.to_string(),
        run_id: opts.run_id.to_string(),
        turn_index,
        prompt: opts.prompt.to_string(),
        status: "queued".to_string(),
        created_at: now,
        updated_at: now,
        summary: None,
        has_diff: 0,
    })
}

pub fn find_queued_run_turns_by_run_id(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Vec<RunTurnRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM run_turns WHERE run_id = ? AND status = 'queued' ORDER BY turn_index ASC",
    )?;
    let rows = stmt.query_map(params![run_id], row_to_run_turn)?;
    rows.collect()
}

pub fn update_queued_turn_prompt(
    conn: &Connection,
    turn_id: &str,
    prompt: &str,
) -> rusqlite::Result<Option<RunTurnRow>> {
    let turn = match find_run_turn_by_id(conn, turn_id)? {
        Some(t) => t,
        None => return Ok(None),
    };
    if turn.status != "queued" {
        return Ok(None);
    }

    let now = now_ms();
    conn.execute(
        "UPDATE run_turns SET prompt = ?, updated_at = ? WHERE id = ?",
        params![prompt, now, turn_id],
    )?;

    Ok(Some(RunTurnRow {
        prompt: prompt.to_string(),
        updated_at: now,
        ..turn
    }))
}

pub fn delete_queued_turns_by_run_id(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<usize> {
    let changes = conn.execute(
        "DELETE FROM run_turns WHERE run_id = ? AND status = 'queued'",
        params![run_id],
    )?;
    Ok(changes)
}
