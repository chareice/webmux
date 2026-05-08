use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

pub mod bookmarks;
pub mod hub_state;
pub mod machines;
pub mod settings;
pub mod terminal_sessions;
pub mod tokens;
pub mod types;
pub mod users;
pub mod workspace_groups;

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

        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_machine ON bookmarks(machine_id);
        CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_groups_machine
            ON workspace_groups(user_id, machine_id, sort_order);

        CREATE TABLE IF NOT EXISTS terminal_sessions (
            id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
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

    // Startup recovery: mark all machines offline
    conn.execute("UPDATE machines SET status = 'offline'", [])?;

    Ok(())
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
