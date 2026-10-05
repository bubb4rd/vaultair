//! `vault_settings`: one text value per key. The service that owns a key
//! decides what its value means.

use rusqlite::{params, Connection, OptionalExtension};

pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM vault_settings WHERE key = ?1",
        [key],
        |r| r.get(0),
    )
    .optional()
}

pub fn set(conn: &Connection, key: &str, value: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO vault_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM vault_settings WHERE key = ?1", [key])?;
    Ok(())
}
