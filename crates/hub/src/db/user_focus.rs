use rusqlite::{params, Connection, OptionalExtension};

use super::now_ms;

pub fn get_user_focus(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Option<(String, String, i64)>> {
    conn.query_row(
        "SELECT terminal_id, machine_id, updated_at FROM user_focus WHERE user_id = ?1",
        params![user_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
}

pub fn set_user_focus(
    conn: &Connection,
    user_id: &str,
    terminal_id: &str,
    machine_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO user_focus (user_id, terminal_id, machine_id, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
             terminal_id = excluded.terminal_id,
             machine_id = excluded.machine_id,
             updated_at = excluded.updated_at",
        params![user_id, terminal_id, machine_id, now_ms()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    #[test]
    fn user_focus_is_upserted_per_user() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "user-a", "test", "user-a", "User A", None, "user")
            .unwrap();

        assert_eq!(get_user_focus(&conn, "user-a").unwrap(), None);

        set_user_focus(&conn, "user-a", "term-a", "machine-a").unwrap();
        let first = get_user_focus(&conn, "user-a").unwrap().unwrap();
        assert_eq!(
            (&first.0, &first.1),
            (&"term-a".to_string(), &"machine-a".to_string())
        );

        set_user_focus(&conn, "user-a", "term-b", "machine-b").unwrap();
        let updated = get_user_focus(&conn, "user-a").unwrap().unwrap();
        assert_eq!(
            (&updated.0, &updated.1),
            (&"term-b".to_string(), &"machine-b".to_string())
        );
        assert!(updated.2 >= first.2);
    }
}
