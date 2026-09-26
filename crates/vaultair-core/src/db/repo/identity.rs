//! Identities, the accounts assigned to them, and the identity rows of the
//! search index (kept in step inside the same transaction as every write).

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::identity::{
    ContactRole, IdentityColor, IdentityDetail, IdentityRef, IdentitySummary, OverviewAccount,
};

/// The columns the identity form edits, already validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityFields {
    pub name: String,
    pub description: Option<String>,
    pub primary_email: Option<String>,
    pub recovery_email: Option<String>,
    pub phone_ref: Option<String>,
    pub notes: Option<String>,
    pub color: Option<IdentityColor>,
}

pub fn insert(conn: &Connection, id: &str, f: &IdentityFields, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO identity (id, name, description, primary_email, recovery_email, phone_ref,
            notes, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            f.name,
            f.description,
            f.primary_email,
            f.recovery_email,
            f.phone_ref,
            f.notes,
            f.color,
            now
        ],
    )?;
    Ok(())
}

/// Returns false if there is no such identity.
pub fn update_fields(
    conn: &Connection,
    id: &str,
    f: &IdentityFields,
    now: &str,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE identity SET name = ?2, description = ?3, primary_email = ?4, recovery_email = ?5,
            phone_ref = ?6, notes = ?7, color = ?8, updated_at = ?9
         WHERE id = ?1",
        params![
            id,
            f.name,
            f.description,
            f.primary_email,
            f.recovery_email,
            f.phone_ref,
            f.notes,
            f.color,
            now
        ],
    )?;
    Ok(n == 1)
}

pub fn name(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT name FROM identity WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()
}

/// Whether another identity (not `except`) already has this name,
/// case-insensitively.
pub fn name_taken(conn: &Connection, name: &str, except: Option<&str>) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM identity WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )
}

/// `Some(archived)` if the identity exists.
pub fn archived(conn: &Connection, id: &str) -> rusqlite::Result<Option<bool>> {
    conn.query_row(
        "SELECT archived_at IS NOT NULL FROM identity WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .optional()
}

pub fn set_archived(
    conn: &Connection,
    id: &str,
    archived_at: Option<&str>,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE identity SET archived_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, archived_at, now],
    )? == 1)
}

/// Deletes the identity. Accounts and contact points referring to it keep
/// their rows (`ON DELETE SET NULL`); its tag links cascade.
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    unindex(conn, id)?;
    Ok(conn.execute("DELETE FROM identity WHERE id = ?1", [id])? == 1)
}

pub fn detail(conn: &Connection, id: &str) -> rusqlite::Result<Option<IdentityDetail>> {
    let found = conn
        .query_row(
            "SELECT id, name, description, primary_email, recovery_email, phone_ref, notes, color,
                    archived_at, created_at, updated_at
             FROM identity WHERE id = ?1",
            [id],
            |r| {
                Ok(IdentityDetail {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    primary_email: r.get(3)?,
                    recovery_email: r.get(4)?,
                    phone_ref: r.get(5)?,
                    notes: r.get(6)?,
                    color: r.get(7)?,
                    tags: Vec::new(),
                    archived_at: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            },
        )
        .optional()?;
    let Some(mut detail) = found else {
        return Ok(None);
    };
    detail.tags = super::tag::for_identity(conn, id)?;
    Ok(Some(detail))
}

fn count(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

fn summary_row(r: &Row<'_>) -> rusqlite::Result<IdentitySummary> {
    Ok(IdentitySummary {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        primary_email: r.get(3)?,
        color: r.get(4)?,
        account_count: count(r.get(5)?),
        accounts_without_mfa: count(r.get(6)?),
        archived_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

/// Active (`archived` false) or archived identities, by name.
pub fn summaries(conn: &Connection, archived: bool) -> rusqlite::Result<Vec<IdentitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, i.description, i.primary_email, i.color,
                (SELECT COUNT(*) FROM account a WHERE a.identity_id = i.id AND a.archived_at IS NULL),
                (SELECT COUNT(*) FROM account a WHERE a.identity_id = i.id AND a.archived_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1)),
                i.archived_at, i.updated_at
         FROM identity i
         WHERE (i.archived_at IS NOT NULL) = ?1
         ORDER BY i.name COLLATE NOCASE, i.id",
    )?;
    let rows = stmt.query_map([archived], summary_row)?;
    rows.collect()
}

/// Active identities for pickers, by name.
pub fn refs(conn: &Connection) -> rusqlite::Result<Vec<IdentityRef>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color FROM identity WHERE archived_at IS NULL
         ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(IdentityRef {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
        })
    })?;
    rows.collect()
}

// ---- Accounts ------------------------------------------------------------------

/// Every account (archived too) assigned to the identity.
pub fn account_ids(conn: &Connection, identity_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM account WHERE identity_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map([identity_id], |r| r.get(0))?;
    rows.collect()
}

/// Assigns one account (or, with `None`, unassigns it). Assigning doesn't
/// count as editing the account, so `updated_at` stays. False if there is
/// no such account.
pub fn set_account_identity(
    conn: &Connection,
    account_id: &str,
    identity_id: Option<&str>,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET identity_id = ?2 WHERE id = ?1",
        params![account_id, identity_id],
    )? == 1)
}

/// The account's identity. Outer `None`: no such account.
pub fn account_identity(
    conn: &Connection,
    account_id: &str,
) -> rusqlite::Result<Option<Option<String>>> {
    conn.query_row(
        "SELECT identity_id FROM account WHERE id = ?1",
        [account_id],
        |r| r.get(0),
    )
    .optional()
}

/// The columns `OverviewAccount` needs, from an `account a` joined to
/// `purpose_label p`.
const OVERVIEW_COLS: &str = "a.id, a.title, a.account_type, a.status, p.name,
    EXISTS(SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1)";

fn overview_account(r: &Row<'_>) -> rusqlite::Result<OverviewAccount> {
    Ok(OverviewAccount {
        id: r.get(0)?,
        title: r.get(1)?,
        account_type: r.get(2)?,
        status: r.get(3)?,
        purpose_name: r.get(4)?,
        mfa_enabled: r.get(5)?,
    })
}

/// The identity's active accounts, each with its platform (or publisher),
/// by title.
pub fn overview_accounts(
    conn: &Connection,
    identity_id: &str,
) -> rusqlite::Result<Vec<(OverviewAccount, Option<String>)>> {
    let sql = format!(
        "SELECT {OVERVIEW_COLS}, COALESCE(pl.name, NULLIF(trim(a.publisher), ''))
         FROM account a
         JOIN purpose_label p ON p.id = a.purpose_id
         LEFT JOIN platform pl ON pl.id = a.platform_id
         WHERE a.identity_id = ?1 AND a.archived_at IS NULL
         ORDER BY a.title COLLATE NOCASE, a.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([identity_id], |r| Ok((overview_account(r)?, r.get(6)?)))?;
    rows.collect()
}

/// Links between the identity's active accounts and contact points:
/// `(account_id, contact_point_id, role)`.
pub fn contact_links(
    conn: &Connection,
    identity_id: &str,
) -> rusqlite::Result<Vec<(String, String, ContactRole)>> {
    let mut stmt = conn.prepare(
        "SELECT ac.account_id, ac.contact_point_id, ac.role
         FROM account_contact ac JOIN account a ON a.id = ac.account_id
         WHERE a.identity_id = ?1 AND a.archived_at IS NULL
         ORDER BY ac.contact_point_id, ac.account_id, ac.role",
    )?;
    let rows = stmt.query_map([identity_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

/// The email-type accounts, anywhere in the vault, that sign in with the
/// contact point: the mailbox behind an email address.
pub fn mailbox_accounts(
    conn: &Connection,
    contact_id: &str,
) -> rusqlite::Result<Vec<OverviewAccount>> {
    let sql = format!(
        "SELECT {OVERVIEW_COLS}
         FROM account a JOIN purpose_label p ON p.id = a.purpose_id
         WHERE a.account_type = 'email' AND a.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM account_contact ac WHERE ac.account_id = a.id
                         AND ac.contact_point_id = ?1 AND ac.role = 'login_email')
         ORDER BY a.title COLLATE NOCASE, a.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([contact_id], overview_account)?;
    rows.collect()
}

// ---- Search index -----------------------------------------------------------

/// Rewrites the identity's search row. The phone reference is left out: it's
/// the least useful thing to search by and the most sensitive.
pub fn reindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    unindex(conn, id)?;
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, title, username, email, game, platform,
            publisher, tags, identity, purpose, notes, region, player_id)
         SELECT 'identity', i.id, i.name, '',
                trim(COALESCE(i.primary_email, '') || ' ' || COALESCE(i.recovery_email, '')),
                '', '', '',
                COALESCE((SELECT group_concat(t.name, ' ') FROM identity_tag x
                          JOIN tag t ON t.id = x.tag_id WHERE x.identity_id = i.id), ''),
                i.name, '',
                trim(COALESCE(i.description, '') || ' ' || COALESCE(i.notes, '')), '', ''
         FROM identity i WHERE i.id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn unindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = 'identity' AND entity_id = ?1",
        [id],
    )?;
    Ok(())
}
