use rusqlite::{Connection, params};

use super::types::NotificationDeviceRow;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn row_to_notification_device(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<NotificationDeviceRow> {
    Ok(NotificationDeviceRow {
        installation_id: row.get("installation_id")?,
        user_id: row.get("user_id")?,
        platform: row.get("platform")?,
        provider: row.get("provider")?,
        push_token: row.get("push_token")?,
        device_name: row.get("device_name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub struct UpsertNotificationDeviceOpts<'a> {
    pub installation_id: &'a str,
    pub user_id: &'a str,
    pub platform: &'a str,
    pub provider: &'a str,
    pub push_token: &'a str,
    pub device_name: Option<&'a str>,
}

pub fn upsert_notification_device(
    conn: &Connection,
    opts: UpsertNotificationDeviceOpts<'_>,
) -> rusqlite::Result<NotificationDeviceRow> {
    let now = now_ms();

    // Check if existing record to preserve created_at
    let existing_created_at: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM notification_devices WHERE installation_id = ?",
            params![opts.installation_id],
            |row| row.get(0),
        )
        .ok();

    let created_at = existing_created_at.unwrap_or(now);

    conn.execute(
        "INSERT INTO notification_devices (
            installation_id,
            user_id,
            platform,
            provider,
            push_token,
            device_name,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(installation_id) DO UPDATE SET
            user_id = excluded.user_id,
            platform = excluded.platform,
            provider = excluded.provider,
            push_token = excluded.push_token,
            device_name = excluded.device_name,
            updated_at = excluded.updated_at",
        params![
            opts.installation_id,
            opts.user_id,
            opts.platform,
            opts.provider,
            opts.push_token,
            opts.device_name,
            created_at,
            now,
        ],
    )?;

    let mut stmt = conn.prepare(
        "SELECT * FROM notification_devices WHERE installation_id = ?",
    )?;
    let mut rows =
        stmt.query_map(params![opts.installation_id], row_to_notification_device)?;
    // We just inserted/updated, so this must exist
    Ok(rows.next().unwrap()?)
}

pub fn find_notification_devices_by_user_id(
    conn: &Connection,
    user_id: &str,
) -> rusqlite::Result<Vec<NotificationDeviceRow>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM notification_devices WHERE user_id = ? ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![user_id], row_to_notification_device)?;
    rows.collect()
}

pub fn delete_notification_device(
    conn: &Connection,
    user_id: &str,
    installation_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM notification_devices WHERE installation_id = ? AND user_id = ?",
        params![installation_id, user_id],
    )?;
    Ok(())
}
