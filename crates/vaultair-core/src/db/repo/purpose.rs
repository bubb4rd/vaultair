//! Purpose labels. Phase 7 only reads them (built-ins are seeded by the V2
//! migration); creating, renaming and hiding arrive in Phase 9.

use rusqlite::{Connection, OptionalExtension};

use crate::domain::account::PurposeView;

/// Purposes the account form offers, in display order.
pub fn list_visible(conn: &Connection) -> rusqlite::Result<Vec<PurposeView>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, name, is_builtin FROM purpose_label
         WHERE is_hidden = 0 ORDER BY sort_order, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PurposeView {
            id: r.get(0)?,
            slug: r.get(1)?,
            name: r.get(2)?,
            is_builtin: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM purpose_label WHERE id = ?1)",
        [id],
        |r| r.get(0),
    )
}

pub fn id_by_slug(conn: &Connection, slug: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM purpose_label WHERE slug = ?1",
        [slug],
        |r| r.get(0),
    )
    .optional()
}
