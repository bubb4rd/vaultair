//! Contact points: the emails and phones accounts sign in and recover
//! through, and the links (`account_contact`) between them and accounts.
//!
//! Contact points are derived, not edited directly: an account save upserts
//! its login email, recovery email and recovery phone, and an identity save
//! upserts the identity's own email and phone. `prune_unused` removes the
//! ones nothing refers to any more.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::new_id;
use crate::domain::identity::{normalize_contact, ContactKind, ContactPointView, ContactRole};

/// Returns the id of the contact point for `value`, creating it if needed.
/// `value` is already validated and trimmed; the first spelling is kept for
/// display.
pub fn upsert(
    conn: &Connection,
    kind: ContactKind,
    value: &str,
    now: &str,
) -> rusqlite::Result<String> {
    let normalized = normalize_contact(value);
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM contact_point WHERE kind = ?1 AND value_normalized = ?2",
            params![kind, normalized],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = new_id();
    let display = if kind == ContactKind::Email {
        normalized.clone()
    } else {
        value.trim().to_owned()
    };
    conn.execute(
        "INSERT INTO contact_point (id, kind, value_normalized, value_display, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, kind, normalized, display, now],
    )?;
    Ok(id)
}

/// Sets the account's one contact point for `role` (or removes it).
pub fn set_account_role(
    conn: &Connection,
    account_id: &str,
    role: ContactRole,
    contact_id: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM account_contact WHERE account_id = ?1 AND role = ?2",
        params![account_id, role],
    )?;
    if let Some(cid) = contact_id {
        conn.execute(
            "INSERT INTO account_contact (account_id, contact_point_id, role) VALUES (?1, ?2, ?3)",
            params![account_id, cid, role],
        )?;
    }
    Ok(())
}

/// The display value of the account's contact point for `role`.
pub fn account_value(
    conn: &Connection,
    account_id: &str,
    role: ContactRole,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT COALESCE(c.value_display, c.value_normalized)
         FROM account_contact ac JOIN contact_point c ON c.id = ac.contact_point_id
         WHERE ac.account_id = ?1 AND ac.role = ?2
         ORDER BY c.id LIMIT 1",
        params![account_id, role],
        |r| r.get(0),
    )
    .optional()
}

/// Marks the contact points `ids` as declared by `identity_id`, and releases
/// any it declared before that aren't in `ids`.
pub fn set_identity_claims(
    conn: &Connection,
    identity_id: &str,
    ids: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE contact_point SET identity_id = NULL WHERE identity_id = ?1",
        [identity_id],
    )?;
    for id in ids {
        conn.execute(
            "UPDATE contact_point SET identity_id = ?2 WHERE id = ?1",
            params![id, identity_id],
        )?;
    }
    Ok(())
}

/// Discards (`at` set) or brings back (`None`) the suggestion to add the
/// mailbox account behind an email. False if `id` isn't an email.
pub fn set_mailbox_dismissed(
    conn: &Connection,
    id: &str,
    at: Option<&str>,
) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE contact_point SET mailbox_dismissed_at = ?2 WHERE id = ?1 AND kind = 'email'",
        params![id, at],
    )?;
    Ok(changed > 0)
}

/// Deletes contact points nothing refers to: no account link, no MFA method,
/// no identity declaring it, and no label or notes of the user's own.
pub fn prune_unused(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM contact_point
         WHERE identity_id IS NULL AND label IS NULL AND notes IS NULL
           AND NOT EXISTS (SELECT 1 FROM account_contact ac WHERE ac.contact_point_id = contact_point.id)
           AND NOT EXISTS (SELECT 1 FROM mfa_method m WHERE m.contact_point_id = contact_point.id)",
        [],
    )?;
    Ok(())
}

const VIEW_SELECT: &str = "
    SELECT c.id, c.kind, COALESCE(c.value_display, c.value_normalized, ''), c.label, c.identity_id,
           (SELECT COUNT(DISTINCT ac.account_id) FROM account_contact ac
              JOIN account a ON a.id = ac.account_id
             WHERE ac.contact_point_id = c.id AND a.archived_at IS NULL)
    FROM contact_point c";

pub(crate) fn view_row(r: &Row<'_>) -> rusqlite::Result<ContactPointView> {
    let count: i64 = r.get(5)?;
    Ok(ContactPointView {
        id: r.get(0)?,
        kind: r.get(1)?,
        value: r.get(2)?,
        label: r.get(3)?,
        identity_id: r.get(4)?,
        account_count: u32::try_from(count.max(0)).unwrap_or(u32::MAX),
    })
}

/// Every contact point, emails first, then by value.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ContactPointView>> {
    let sql = format!("{VIEW_SELECT} ORDER BY c.kind <> 'email', c.kind, c.value_normalized");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], view_row)?;
    rows.collect()
}

pub fn view(conn: &Connection, id: &str) -> rusqlite::Result<Option<ContactPointView>> {
    let sql = format!("{VIEW_SELECT} WHERE c.id = ?1");
    conn.query_row(&sql, [id], view_row).optional()
}
