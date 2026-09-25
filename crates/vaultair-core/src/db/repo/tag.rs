//! Tags: free-form, case-insensitively unique labels on accounts.

use rusqlite::{params, Connection, OptionalExtension};

use super::new_id;

/// Every tag name, alphabetically.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tag ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// An account's tags, alphabetically.
pub fn for_account(conn: &Connection, account_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM account_tag at JOIN tag t ON t.id = at.tag_id
         WHERE at.account_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([account_id], |r| r.get(0))?;
    rows.collect()
}

/// Replaces an account's tags with `names` (already validated). A name that
/// matches an existing tag case-insensitively reuses it.
pub fn set_for_account(
    conn: &Connection,
    account_id: &str,
    names: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM account_tag WHERE account_id = ?1",
        [account_id],
    )?;
    for name in names {
        let existing: Option<String> = conn
            .query_row("SELECT id FROM tag WHERE name = ?1", [name], |r| r.get(0))
            .optional()?;
        let tag_id = match existing {
            Some(id) => id,
            None => {
                let id = new_id();
                conn.execute(
                    "INSERT INTO tag (id, name) VALUES (?1, ?2)",
                    params![id, name],
                )?;
                id
            }
        };
        conn.execute(
            "INSERT OR IGNORE INTO account_tag (account_id, tag_id) VALUES (?1, ?2)",
            params![account_id, tag_id],
        )?;
    }
    Ok(())
}

/// Deletes tags nothing uses any more, so the suggestions stay tidy.
pub fn prune_unused(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM account_tag)
                           AND id NOT IN (SELECT tag_id FROM identity_tag)",
        [],
    )?;
    Ok(())
}
