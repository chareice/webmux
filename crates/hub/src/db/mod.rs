use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use serde::Deserialize;
use tc_protocol::{WorkspaceLayoutNode, WorkspaceSplitDirection};

pub mod bookmarks;
pub mod hub_state;
pub mod machines;
pub mod settings;
pub mod terminal_sessions;
pub mod tokens;
pub mod types;
pub mod user_focus;
pub mod users;
pub mod workspace_groups;
pub mod workspace_layouts;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn create_pool(path: &str) -> Result<DbPool, Box<dyn std::error::Error>> {
    let manager = SqliteConnectionManager::file(path);
    let pool = Pool::builder().max_size(8).build(manager)?;
    let conn = pool.get()?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(pool)
}

pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL,
            UNIQUE(provider, provider_id)
        );

        CREATE TABLE IF NOT EXISTS machines (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            machine_secret_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'offline',
            os TEXT,
            home_dir TEXT,
            last_seen_at INTEGER,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS registration_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            machine_name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            label TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_groups (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_layouts (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            group_key TEXT NOT NULL,
            root_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, machine_id, group_key)
        );

        CREATE TABLE IF NOT EXISTS api_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            expires_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, key)
        );

        CREATE TABLE IF NOT EXISTS user_focus (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            terminal_id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_machine ON bookmarks(machine_id);
        CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_groups_machine
            ON workspace_groups(user_id, machine_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_workspace_layouts_machine
            ON workspace_layouts(user_id, machine_id);

        CREATE TABLE IF NOT EXISTS terminal_sessions (
            id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            title_source TEXT NOT NULL DEFAULT 'none',
            cwd TEXT NOT NULL,
            workspace_group_id TEXT REFERENCES workspace_groups(id) ON DELETE SET NULL,
            cols INTEGER NOT NULL,
            rows INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            destroyed_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_machine
            ON terminal_sessions(machine_id);

        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_active
            ON terminal_sessions(machine_id) WHERE destroyed_at IS NULL;

        CREATE TABLE IF NOT EXISTS hub_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ",
    )?;

    if !column_exists(conn, "terminal_sessions", "workspace_group_id")? {
        conn.execute(
            "ALTER TABLE terminal_sessions ADD COLUMN workspace_group_id TEXT REFERENCES workspace_groups(id) ON DELETE SET NULL",
            [],
        )?;
    }

    if !column_exists(conn, "terminal_sessions", "title_source")? {
        conn.execute(
            "ALTER TABLE terminal_sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'none'",
            [],
        )?;
    }

    migrate_scrollable_workspace_layouts(conn)?;

    // Startup recovery: mark all machines offline
    conn.execute("UPDATE machines SET status = 'offline'", [])?;

    Ok(())
}

#[derive(Deserialize)]
struct LegacyScrollableLayout {
    columns: Vec<LegacyScrollableColumn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyScrollableColumn {
    terminal_id: String,
}

fn migrate_scrollable_workspace_layouts(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "workspace_layouts", "layout_mode")?
        || !column_exists(conn, "workspace_layouts", "aux_json")?
    {
        return Ok(());
    }

    let legacy_rows = {
        let mut statement = conn.prepare(
            "SELECT rowid, aux_json FROM workspace_layouts WHERE layout_mode = 'scrollable'",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for (row_id, aux_json) in legacy_rows {
        let Some(layout) = aux_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<LegacyScrollableLayout>(json).ok())
        else {
            continue;
        };
        let terminal_ids = layout
            .columns
            .into_iter()
            .map(|column| column.terminal_id)
            .collect::<Vec<_>>();
        let root_json = serde_json::to_string(&split_tree_from_terminal_ids(&terminal_ids))
            .expect("workspace split trees are serializable");
        conn.execute(
            "UPDATE workspace_layouts SET root_json = ?1 WHERE rowid = ?2",
            rusqlite::params![root_json, row_id],
        )?;
    }

    conn.execute(
        "UPDATE workspace_layouts SET layout_mode = NULL, aux_json = NULL",
        [],
    )?;
    Ok(())
}

fn split_tree_from_terminal_ids(terminal_ids: &[String]) -> Option<WorkspaceLayoutNode> {
    match terminal_ids {
        [] => None,
        [terminal_id] => Some(WorkspaceLayoutNode::Leaf {
            terminal_id: terminal_id.clone(),
        }),
        [terminal_id, remaining @ ..] => Some(WorkspaceLayoutNode::Split {
            direction: WorkspaceSplitDirection::Horizontal,
            ratio: 0.5,
            first: Box::new(WorkspaceLayoutNode::Leaf {
                terminal_id: terminal_id.clone(),
            }),
            second: Box::new(
                split_tree_from_terminal_ids(remaining)
                    .expect("a non-empty remainder produces a split tree"),
            ),
        }),
    }
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
