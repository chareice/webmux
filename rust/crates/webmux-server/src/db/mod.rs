pub mod types;
pub mod users;
pub mod agents;
pub mod runs;
pub mod projects;
pub mod tasks;
pub mod llm_configs;
pub mod notifications;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use tracing::info;

pub type DbPool = Pool<SqliteConnectionManager>;

/// Create a connection pool for the given database path.
pub fn create_pool(path: &str) -> Result<DbPool, Box<dyn std::error::Error>> {
    let manager = SqliteConnectionManager::file(path);
    let pool = Pool::builder().max_size(8).build(manager)?;
    // Enable WAL mode and foreign keys on the first connection
    let conn = pool.get()?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(pool)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Initialize the database: create all tables, run migrations, perform startup recovery.
pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    // If old schema exists (github_id column), drop and recreate
    let has_github_id = {
        let mut stmt = conn.prepare("PRAGMA table_info(users)")?;
        let cols = stmt.query_map([], |row| {
            let name: String = row.get("name")?;
            Ok(name)
        })?;
        let mut found = false;
        for col in cols {
            if col? == "github_id" {
                found = true;
                break;
            }
        }
        found
    };

    if has_github_id {
        conn.execute_batch(
            "DROP TABLE IF EXISTS run_events;
             DROP TABLE IF EXISTS runs;
             DROP TABLE IF EXISTS registration_tokens;
             DROP TABLE IF EXISTS agents;
             DROP TABLE IF EXISTS users;",
        )?;
    }

    // Create core tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id              TEXT PRIMARY KEY,
            provider        TEXT NOT NULL,
            provider_id     TEXT NOT NULL,
            display_name    TEXT NOT NULL,
            avatar_url      TEXT,
            role            TEXT NOT NULL DEFAULT 'user',
            created_at      INTEGER NOT NULL,
            UNIQUE(provider, provider_id)
        );

        CREATE TABLE IF NOT EXISTS agents (
            id                  TEXT PRIMARY KEY,
            user_id             TEXT NOT NULL REFERENCES users(id),
            name                TEXT NOT NULL,
            agent_secret_hash   TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'offline',
            last_seen_at        INTEGER,
            created_at          INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS registration_tokens (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            agent_name  TEXT NOT NULL,
            token_hash  TEXT NOT NULL,
            expires_at  INTEGER NOT NULL,
            used        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS runs (
            id            TEXT PRIMARY KEY,
            agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tool          TEXT NOT NULL,
            tool_thread_id TEXT,
            repo_path     TEXT NOT NULL,
            branch        TEXT NOT NULL DEFAULT '',
            prompt        TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'starting',
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            summary       TEXT,
            has_diff      INTEGER NOT NULL DEFAULT 0,
            unread        INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS notification_devices (
            installation_id TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform        TEXT NOT NULL,
            provider        TEXT NOT NULL,
            push_token      TEXT NOT NULL,
            device_name     TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notification_devices_user_id
            ON notification_devices(user_id);

        CREATE TABLE IF NOT EXISTS projects (
            id            TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            name          TEXT NOT NULL,
            description   TEXT NOT NULL DEFAULT '',
            repo_path     TEXT NOT NULL,
            default_tool  TEXT NOT NULL DEFAULT 'claude',
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

        CREATE TABLE IF NOT EXISTS project_actions (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            prompt      TEXT NOT NULL,
            tool        TEXT NOT NULL DEFAULT 'claude',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_project_actions_project_id
            ON project_actions(project_id);

        CREATE TABLE IF NOT EXISTS tasks (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title           TEXT NOT NULL,
            prompt          TEXT NOT NULL,
            tool            TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            priority        INTEGER NOT NULL DEFAULT 0,
            branch_name     TEXT,
            worktree_path   TEXT,
            run_id          TEXT,
            error_message   TEXT,
            summary         TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            claimed_at      INTEGER,
            completed_at    INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

        CREATE TABLE IF NOT EXISTS llm_configs (
            id            TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL,
            project_id    TEXT,
            api_base_url  TEXT NOT NULL,
            api_key       TEXT NOT NULL,
            model         TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
            updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_llm_configs_user ON llm_configs(user_id);

        CREATE TABLE IF NOT EXISTS task_steps (
            id            TEXT PRIMARY KEY,
            task_id       TEXT NOT NULL,
            type          TEXT NOT NULL,
            label         TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'running',
            detail        TEXT,
            tool_name     TEXT NOT NULL,
            run_id        TEXT,
            duration_ms   INTEGER,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
            completed_at  INTEGER,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);

        CREATE TABLE IF NOT EXISTS task_messages (
            id          TEXT PRIMARY KEY,
            task_id     TEXT NOT NULL,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);
        ",
    )?;

    // Run migrations
    migrate_runs_table_if_needed(conn)?;
    ensure_run_turns_table(conn)?;
    ensure_run_turn_attachments_table(conn)?;
    migrate_run_turns_table_if_needed(conn)?;
    migrate_run_turns_if_needed(conn)?;
    migrate_run_events_if_needed(conn)?;
    ensure_run_events_table(conn)?;
    conn.execute_batch("DROP TABLE IF EXISTS run_output_chunks")?;

    // Migrate: add summary column to tasks for existing databases
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN summary TEXT");

    // Migrate: add tool column to tasks for existing databases
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN tool TEXT");

    // Migrate: add data column to run_turn_attachments for image persistence
    let _ = conn.execute_batch("ALTER TABLE run_turn_attachments ADD COLUMN data TEXT");

    // Ensure task_attachments table exists
    ensure_task_attachments_table(conn)?;

    // --- Startup recovery ---
    startup_recovery(conn)?;

    info!("Database initialized successfully");
    Ok(())
}

/// On server startup, clean up stale state from a previous run.
fn startup_recovery(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_ms();

    // 1. Mark all agents as offline (they will reconnect if still alive)
    conn.execute("UPDATE agents SET status = 'offline'", [])?;

    // 2. Fail any runs/turns that were active when the server stopped
    conn.execute(
        "UPDATE run_turns SET status = 'failed', summary = 'Server restarted while this task was running.', updated_at = ?
         WHERE status IN ('starting', 'running')",
        rusqlite::params![now],
    )?;
    conn.execute(
        "UPDATE runs SET status = 'failed', summary = 'Server restarted while this task was running.', updated_at = ?
         WHERE status IN ('starting', 'running')",
        rusqlite::params![now],
    )?;

    // 3. Reset dispatched/running tasks to pending so they auto-redispatch
    //    when the agent reconnects. Waiting tasks stay as-is.
    conn.execute(
        "UPDATE tasks SET status = 'pending', error_message = NULL, updated_at = ?
         WHERE status IN ('dispatched', 'running')",
        rusqlite::params![now],
    )?;

    Ok(())
}

// --- Migration helpers ---

fn migrate_runs_table_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    let has_runs_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !has_runs_table {
        return Ok(());
    }

    // Check foreign keys
    let mut fk_stmt = conn.prepare("PRAGMA foreign_key_list(runs)")?;
    let fks: Vec<(String, String)> = fk_stmt
        .query_map([], |row| {
            let table: String = row.get("table")?;
            let on_delete: String = row.get("on_delete")?;
            Ok((table, on_delete))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut col_stmt = conn.prepare("PRAGMA table_info(runs)")?;
    let columns: Vec<String> = col_stmt
        .query_map([], |row| {
            let name: String = row.get("name")?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    let has_cascade_agent_fk = fks
        .iter()
        .any(|(t, d)| t == "agents" && d.to_uppercase() == "CASCADE");
    let has_cascade_user_fk = fks
        .iter()
        .any(|(t, d)| t == "users" && d.to_uppercase() == "CASCADE");
    let has_legacy_tmux_session = columns.iter().any(|c| c == "tmux_session");
    let has_tool_thread_id = columns.iter().any(|c| c == "tool_thread_id");

    if has_cascade_agent_fk && has_cascade_user_fk && !has_legacy_tmux_session && has_tool_thread_id
    {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.execute_batch(
        "
        ALTER TABLE runs RENAME TO runs_legacy;

        CREATE TABLE runs (
            id            TEXT PRIMARY KEY,
            agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tool          TEXT NOT NULL,
            tool_thread_id TEXT,
            repo_path     TEXT NOT NULL,
            branch        TEXT NOT NULL DEFAULT '',
            prompt        TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'starting',
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            summary       TEXT,
            has_diff      INTEGER NOT NULL DEFAULT 0,
            unread        INTEGER NOT NULL DEFAULT 1
        );

        INSERT INTO runs (
            id, agent_id, user_id, tool, tool_thread_id,
            repo_path, branch, prompt, status,
            created_at, updated_at, summary, has_diff, unread
        )
        SELECT
            id, agent_id, user_id, tool, NULL,
            repo_path, branch, prompt, status,
            created_at, updated_at, summary, has_diff, unread
        FROM runs_legacy;

        DROP TABLE runs_legacy;
        ",
    )?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

fn ensure_run_turns_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS run_turns (
            id          TEXT PRIMARY KEY,
            run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            turn_index  INTEGER NOT NULL,
            prompt      TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'starting',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            summary     TEXT,
            has_diff    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(run_id, turn_index)
        );

        CREATE INDEX IF NOT EXISTS idx_run_turns_run_id_turn_index
            ON run_turns(run_id, turn_index);
        ",
    )?;
    Ok(())
}

fn ensure_run_turn_attachments_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS run_turn_attachments (
            id          TEXT PRIMARY KEY,
            turn_id     TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            mime_type   TEXT NOT NULL,
            size_bytes  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_run_turn_attachments_turn_id
            ON run_turn_attachments(turn_id);
        ",
    )?;
    Ok(())
}

fn ensure_task_attachments_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS task_attachments (
            id          TEXT PRIMARY KEY,
            task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            mime_type   TEXT NOT NULL,
            size_bytes  INTEGER NOT NULL,
            data        TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id
            ON task_attachments(task_id);
        ",
    )?;
    Ok(())
}

fn migrate_run_turns_table_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    let has_run_turns_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_turns'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !has_run_turns_table {
        return Ok(());
    }

    let mut col_stmt = conn.prepare("PRAGMA table_info(run_turns)")?;
    let columns: Vec<String> = col_stmt
        .query_map([], |row| {
            let name: String = row.get("name")?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut fk_stmt = conn.prepare("PRAGMA foreign_key_list(run_turns)")?;
    let fks: Vec<(String, String)> = fk_stmt
        .query_map([], |row| {
            let table: String = row.get("table")?;
            let on_delete: String = row.get("on_delete")?;
            Ok((table, on_delete))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let has_run_id = columns.iter().any(|c| c == "run_id");
    let has_run_cascade_fk = fks
        .iter()
        .any(|(t, d)| t == "runs" && d.to_uppercase() == "CASCADE");

    if has_run_id && has_run_cascade_fk {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.execute_batch(
        "
        ALTER TABLE run_turns RENAME TO run_turns_legacy;
        DROP INDEX IF EXISTS idx_run_turns_run_id_turn_index;

        CREATE TABLE run_turns (
            id          TEXT PRIMARY KEY,
            run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            turn_index  INTEGER NOT NULL,
            prompt      TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'starting',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            summary     TEXT,
            has_diff    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(run_id, turn_index)
        );

        CREATE INDEX idx_run_turns_run_id_turn_index
            ON run_turns(run_id, turn_index);

        INSERT INTO run_turns (
            id, run_id, turn_index, prompt, status,
            created_at, updated_at, summary, has_diff
        )
        SELECT
            id, run_id, turn_index, prompt, status,
            created_at, updated_at, summary, has_diff
        FROM run_turns_legacy;

        DROP TABLE run_turns_legacy;
        ",
    )?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

fn migrate_run_turns_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) AS cnt FROM run_turns", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let mut stmt = conn.prepare(
        "SELECT id, prompt, status, created_at, updated_at, summary, has_diff FROM runs ORDER BY created_at ASC",
    )?;

    struct RunSeed {
        id: String,
        prompt: String,
        status: String,
        created_at: i64,
        updated_at: i64,
        summary: Option<String>,
        has_diff: i64,
    }

    let runs: Vec<RunSeed> = stmt
        .query_map([], |row| {
            Ok(RunSeed {
                id: row.get("id")?,
                prompt: row.get("prompt")?,
                status: row.get("status")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                summary: row.get("summary")?,
                has_diff: row.get("has_diff")?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut insert_stmt = conn.prepare(
        "INSERT INTO run_turns (
            id, run_id, turn_index, prompt, status,
            created_at, updated_at, summary, has_diff
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)",
    )?;

    for run in &runs {
        let turn_id = initial_turn_id_for_run(&run.id);
        insert_stmt.execute(rusqlite::params![
            turn_id,
            run.id,
            run.prompt,
            run.status,
            run.created_at,
            run.updated_at,
            run.summary,
            run.has_diff,
        ])?;
    }

    Ok(())
}

fn ensure_run_events_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS run_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            turn_id      TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
            event_type   TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_run_events_run_turn_id_id
            ON run_events(run_id, turn_id, id);
        ",
    )?;
    Ok(())
}

fn migrate_run_events_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    let has_run_events_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_events'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !has_run_events_table {
        return Ok(());
    }

    let mut col_stmt = conn.prepare("PRAGMA table_info(run_events)")?;
    let columns: Vec<String> = col_stmt
        .query_map([], |row| {
            let name: String = row.get("name")?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut fk_stmt = conn.prepare("PRAGMA foreign_key_list(run_events)")?;
    let fks: Vec<(String, String)> = fk_stmt
        .query_map([], |row| {
            let table: String = row.get("table")?;
            let on_delete: String = row.get("on_delete")?;
            Ok((table, on_delete))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let has_turn_id = columns.iter().any(|c| c == "turn_id");
    let has_run_cascade_fk = fks
        .iter()
        .any(|(t, d)| t == "runs" && d.to_uppercase() == "CASCADE");
    let has_turn_cascade_fk = fks
        .iter()
        .any(|(t, d)| t == "run_turns" && d.to_uppercase() == "CASCADE");

    if has_turn_id && has_run_cascade_fk && has_turn_cascade_fk {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.execute_batch(
        "
        ALTER TABLE run_events RENAME TO run_events_legacy;
        DROP INDEX IF EXISTS idx_run_events_run_turn_id_id;

        CREATE TABLE run_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            turn_id      TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
            event_type   TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );

        CREATE INDEX idx_run_events_run_turn_id_id
            ON run_events(run_id, turn_id, id);
        ",
    )?;

    // Migrate data
    if has_turn_id {
        let mut sel_stmt = conn.prepare(
            "SELECT run_id, turn_id, event_type, payload_json, created_at FROM run_events_legacy ORDER BY id ASC",
        )?;
        let mut insert_stmt = conn.prepare(
            "INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
        )?;

        let rows: Vec<(String, String, String, String, i64)> = sel_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>("run_id")?,
                    row.get::<_, String>("turn_id")?,
                    row.get::<_, String>("event_type")?,
                    row.get::<_, String>("payload_json")?,
                    row.get::<_, i64>("created_at")?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (run_id, turn_id, event_type, payload_json, created_at) in &rows {
            insert_stmt.execute(rusqlite::params![
                run_id,
                turn_id,
                event_type,
                payload_json,
                created_at,
            ])?;
        }
    } else {
        let mut sel_stmt = conn.prepare(
            "SELECT run_id, event_type, payload_json, created_at FROM run_events_legacy ORDER BY id ASC",
        )?;
        let mut insert_stmt = conn.prepare(
            "INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
        )?;

        let rows: Vec<(String, String, String, i64)> = sel_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>("run_id")?,
                    row.get::<_, String>("event_type")?,
                    row.get::<_, String>("payload_json")?,
                    row.get::<_, i64>("created_at")?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (run_id, event_type, payload_json, created_at) in &rows {
            let turn_id = initial_turn_id_for_run(run_id);
            insert_stmt.execute(rusqlite::params![
                run_id,
                turn_id,
                event_type,
                payload_json,
                created_at,
            ])?;
        }
    }

    conn.execute_batch("DROP TABLE run_events_legacy")?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

fn initial_turn_id_for_run(run_id: &str) -> String {
    format!("{}:turn:1", run_id)
}
