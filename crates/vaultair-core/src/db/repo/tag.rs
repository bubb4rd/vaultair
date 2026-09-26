//! Tags: free-form, case-insensitively unique labels on accounts and
//! identities.

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

/// An identity's tags, alphabetically.
pub fn for_identity(conn: &Connection, identity_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM identity_tag it JOIN tag t ON t.id = it.tag_id
         WHERE it.identity_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([identity_id], |r| r.get(0))?;
    rows.collect()
}

/// The id of the tag called `name` (case-insensitively), created if needed.
fn tag_id(conn: &Connection, name: &str) -> rusqlite::Result<String> {
    let existing: Option<String> = conn
        .query_row("SELECT id FROM tag WHERE name = ?1", [name], |r| r.get(0))
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO tag (id, name) VALUES (?1, ?2)",
        params![id, name],
    )?;
    Ok(id)
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
        conn.execute(
            "INSERT OR IGNORE INTO account_tag (account_id, tag_id) VALUES (?1, ?2)",
            params![account_id, tag_id(conn, name)?],
        )?;
    }
    Ok(())
}

/// Replaces an identity's tags, like `set_for_account`.
pub fn set_for_identity(
    conn: &Connection,
    identity_id: &str,
    names: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM identity_tag WHERE identity_id = ?1",
        [identity_id],
    )?;
    for name in names {
        conn.execute(
            "INSERT OR IGNORE INTO identity_tag (identity_id, tag_id) VALUES (?1, ?2)",
            params![identity_id, tag_id(conn, name)?],
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

/// Adds tags to an account, keeping the ones it has (bulk tagging).
pub fn add_to_account(
    conn: &Connection,
    account_id: &str,
    names: &[String],
) -> rusqlite::Result<()> {
    for name in names {
        conn.execute(
            "INSERT OR IGNORE INTO account_tag (account_id, tag_id) VALUES (?1, ?2)",
            params![account_id, tag_id(conn, name)?],
        )?;
    }
    Ok(())
}

/// Removes tags from an account by name, case-insensitively (bulk tagging).
pub fn remove_from_account(
    conn: &Connection,
    account_id: &str,
    names: &[String],
) -> rusqlite::Result<()> {
    for name in names {
        conn.execute(
            "DELETE FROM account_tag WHERE account_id = ?1
               AND tag_id IN (SELECT id FROM tag WHERE name = ?2)",
            params![account_id, name],
        )?;
    }
    Ok(())
}
