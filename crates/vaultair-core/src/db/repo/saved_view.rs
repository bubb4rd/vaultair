//! Saved views: named account-list filters. `filter_json` holds a `ViewSpec`
//! and is validated again whenever it's read.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::search::SavedView;
use crate::search::ViewSpec;

/// Built-ins first, in their seeded order, then the user's by name. A row
/// whose stored filter doesn't validate is skipped (and logged) rather than
/// breaking the list.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<SavedView>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, icon, filter_json, is_builtin FROM saved_view
         ORDER BY is_builtin DESC, sort_order, name COLLATE NOCASE, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, bool>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, icon, json, is_builtin) = row?;
        match ViewSpec::from_json(&json) {
            Ok(spec) => out.push(SavedView {
                id,
                name,
                icon,
                spec,
                is_builtin,
            }),
            Err(_) => tracing::warn!(view = %id, "skipping a saved view with an invalid filter"),
        }
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<SavedView>> {
    Ok(list(conn)?.into_iter().find(|v| v.id == id))
}

/// `Some(is_builtin)`, or `None` if there's no such view.
pub fn is_builtin(conn: &Connection, id: &str) -> rusqlite::Result<Option<bool>> {
    conn.query_row(
        "SELECT is_builtin FROM saved_view WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .optional()
}

/// Another view already has this name (case-insensitively).
pub fn name_taken(
    conn: &Connection,
    name: &str,
    except_id: Option<&str>,
) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM saved_view
                       WHERE name = ?1 COLLATE NOCASE AND (?2 IS NULL OR id <> ?2))",
        params![name, except_id],
        |r| r.get(0),
    )
}

pub fn user_count(conn: &Connection) -> rusqlite::Result<u32> {
    conn.query_row(
        "SELECT COUNT(*) FROM saved_view WHERE is_builtin = 0",
        [],
        |r| r.get(0),
    )
}

pub fn insert(
    conn: &Connection,
    id: &str,
    name: &str,
    spec: &ViewSpec,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO saved_view (id, name, icon, filter_json, is_builtin, sort_order, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, 0, 0, ?4, ?4)",
        params![id, name, spec.to_json(), now],
    )?;
    Ok(())
}

/// Only user views change; returns false for a built-in or a missing id.
pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    spec: &ViewSpec,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE saved_view SET name = ?2, filter_json = ?3, updated_at = ?4
         WHERE id = ?1 AND is_builtin = 0",
        params![id, name, spec.to_json(), now],
    )? == 1)
}

/// Only user views can be deleted; returns false for a built-in or a missing id.
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "DELETE FROM saved_view WHERE id = ?1 AND is_builtin = 0",
        [id],
    )? == 1)
}
