//! Purpose labels. Built-ins are seeded by the V2 migration and can be
//! hidden, recoloured and reordered but not renamed or deleted; users add,
//! rename, recolour, reorder and delete their own through the service.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::account::{PurposeColor, PurposeView};

const SELECT: &str = "
    SELECT p.id, p.slug, p.name, p.is_builtin, p.is_hidden, p.color,
           (SELECT COUNT(*) FROM account a WHERE a.purpose_id = p.id)
    FROM purpose_label p";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PurposeView> {
    let count: i64 = r.get(6)?;
    Ok(PurposeView {
        id: r.get(0)?,
        slug: r.get(1)?,
        name: r.get(2)?,
        is_builtin: r.get(3)?,
        is_hidden: r.get(4)?,
        // A colour this version doesn't know reads as none.
        color: r
            .get::<_, Option<String>>(5)?
            .as_deref()
            .and_then(PurposeColor::parse),
        account_count: u32::try_from(count.max(0)).unwrap_or(u32::MAX),
    })
}

/// Every purpose, hidden ones included, in display order.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<PurposeView>> {
    let sql = format!("{SELECT} ORDER BY p.sort_order, p.name COLLATE NOCASE, p.id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<PurposeView>> {
    let sql = format!("{SELECT} WHERE p.id = ?1");
    conn.query_row(&sql, [id], row).optional()
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

/// Every purpose id, in no particular order.
pub fn ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM purpose_label")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// Case-insensitive (ASCII), against built-ins and hidden labels too.
pub fn name_taken(conn: &Connection, name: &str, except: Option<&str>) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM purpose_label
                       WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )
}

pub fn slug_taken(conn: &Connection, slug: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM purpose_label WHERE slug = ?1)",
        [slug],
        |r| r.get(0),
    )
}

/// Visible purposes other than `except`.
pub fn visible_count(conn: &Connection, except: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM purpose_label WHERE is_hidden = 0 AND id <> ?1",
        [except],
        |r| r.get(0),
    )
}

/// A new custom label, after every existing one.
pub fn insert(
    conn: &Connection,
    id: &str,
    slug: &str,
    name: &str,
    color: Option<PurposeColor>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO purpose_label (id, slug, name, is_builtin, is_hidden, color, sort_order,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 0, ?4,
            (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM purpose_label), ?5, ?5)",
        params![id, slug, name, color, now],
    )?;
    Ok(())
}

/// Returns false if there is no such purpose. The slug never changes.
pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    color: Option<PurposeColor>,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE purpose_label SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, name, color, now],
    )? == 1)
}

pub fn set_hidden(conn: &Connection, id: &str, hidden: bool, now: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE purpose_label SET is_hidden = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, hidden, now],
    )? == 1)
}

pub fn set_sort_order(conn: &Connection, id: &str, order: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE purpose_label SET sort_order = ?2 WHERE id = ?1",
        params![id, order],
    )?;
    Ok(())
}

/// Every account (archived too) with the purpose.
pub fn account_ids(conn: &Connection, purpose_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM account WHERE purpose_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map([purpose_id], |r| r.get(0))?;
    rows.collect()
}

/// Moves every account from one purpose to another. Like assigning an
/// identity, this doesn't count as editing the accounts.
pub fn reassign_accounts(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE account SET purpose_id = ?2 WHERE purpose_id = ?1",
        params![from, to],
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM purpose_label WHERE id = ?1", [id])?;
    Ok(())
}
