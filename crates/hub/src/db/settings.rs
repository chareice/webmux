use rusqlite::{params, Connection, OptionalExtension};

use super::now_ms;

/// Get a single setting value by key.
pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// Insert or update a setting (upsert).
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

/// Delete a setting by key.
pub fn delete_setting(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

/// List all settings as (key, value) pairs.
pub fn get_all_settings(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

pub fn get_user_setting(
    conn: &Connection,
    user_id: &str,
    key: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM user_settings WHERE user_id = ?1 AND key = ?2",
        params![user_id, key],
        |row| row.get(0),
    )
    .optional()
}

pub fn get_effective_setting(
    conn: &Connection,
    user_id: &str,
    key: &str,
) -> rusqlite::Result<Option<String>> {
    match get_user_setting(conn, user_id, key)? {
        Some(value) => Ok(Some(value)),
        None => get_setting(conn, key),
    }
}

pub fn set_user_setting(
    conn: &Connection,
    user_id: &str,
    key: &str,
    value: &str,
) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![user_id, key, value, now],
    )?;
    Ok(())
}

pub fn delete_user_setting(conn: &Connection, user_id: &str, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM user_settings WHERE user_id = ?1 AND key = ?2",
        params![user_id, key],
    )?;
    Ok(())
}

pub fn get_all_effective_settings(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<(String, String)>> {
    let mut merged: std::collections::HashMap<String, String> =
        get_all_settings(conn)?.into_iter().collect();
    let mut stmt = conn.prepare(
        "SELECT key, value FROM user_settings WHERE user_id = ?1 ORDER BY key",
    )?;
    let rows = stmt.query_map(params![user_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    for row in rows {
        let (key, value): (String, String) = row?;
        merged.insert(key, value);
    }
    let mut pairs: Vec<(String, String)> = merged.into_iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(pairs)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    #[test]
    fn user_specific_settings_override_global_defaults() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(
            &conn,
            "user-a",
            "test",
            "user-a",
            "User A",
            None,
            "user",
        )
        .unwrap();

        set_setting(&conn, "default_startup_command", "global").unwrap();
        set_user_setting(
            &conn,
            "user-a",
            "default_startup_command",
            "user-a-only",
        )
        .unwrap();

        assert_eq!(
            get_effective_setting(&conn, "user-a", "default_startup_command").unwrap(),
            Some("user-a-only".to_string())
        );
        assert_eq!(
            get_effective_setting(&conn, "user-b", "default_startup_command").unwrap(),
            Some("global".to_string())
        );
    }
}
