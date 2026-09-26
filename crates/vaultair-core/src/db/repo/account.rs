//! Accounts and their custom fields, plus the account rows of the search
//! index (kept in step inside the same transaction as every write).

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::account::{
    AccountDetail, AccountFilter, AccountStatus, AccountSummary, AccountType, CustomFieldType,
    CustomFieldView,
};
use crate::domain::identity::ContactRole;
use crate::domain::notes_hints::NotesSuggestions;

/// The non-secret columns an account form edits, already validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountFields {
    pub title: String,
    pub account_type: AccountType,
    pub purpose_id: String,
    pub status: AccountStatus,
    pub identity_id: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub website_url: Option<String>,
    pub login_url: Option<String>,
    pub platform_id: Option<String>,
    pub game_id: Option<String>,
    pub publisher: Option<String>,
    pub region: Option<String>,
    pub player_id: Option<String>,
    pub display_name: Option<String>,
    pub notes: Option<String>,
}

pub fn insert(conn: &Connection, id: &str, f: &AccountFields, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO account (id, title, account_type, purpose_id, status, username, email,
            website_url, login_url, publisher, region, player_id, display_name, notes,
            created_at, updated_at, identity_id, platform_id, game_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?17, ?18)",
        params![
            id,
            f.title,
            f.account_type,
            f.purpose_id,
            f.status,
            f.username,
            f.email,
            f.website_url,
            f.login_url,
            f.publisher,
            f.region,
            f.player_id,
            f.display_name,
            f.notes,
            now,
            f.identity_id,
            f.platform_id,
            f.game_id
        ],
    )?;
    Ok(())
}

/// Returns false if there is no such account.
pub fn update_fields(
    conn: &Connection,
    id: &str,
    f: &AccountFields,
    now: &str,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE account SET title = ?2, account_type = ?3, purpose_id = ?4, status = ?5,
            username = ?6, email = ?7, website_url = ?8, login_url = ?9, publisher = ?10,
            region = ?11, player_id = ?12, display_name = ?13, notes = ?14, updated_at = ?15,
            identity_id = ?16, platform_id = ?17, game_id = ?18
         WHERE id = ?1",
        params![
            id,
            f.title,
            f.account_type,
            f.purpose_id,
            f.status,
            f.username,
            f.email,
            f.website_url,
            f.login_url,
            f.publisher,
            f.region,
            f.player_id,
            f.display_name,
            f.notes,
            now,
            f.identity_id,
            f.platform_id,
            f.game_id
        ],
    )?;
    Ok(n == 1)
}

pub fn fields(conn: &Connection, id: &str) -> rusqlite::Result<Option<AccountFields>> {
    conn.query_row(
        "SELECT title, account_type, purpose_id, status, username, email, website_url,
                login_url, publisher, region, player_id, display_name, notes, identity_id,
                platform_id, game_id
         FROM account WHERE id = ?1",
        [id],
        |r| {
            Ok(AccountFields {
                title: r.get(0)?,
                account_type: r.get(1)?,
                purpose_id: r.get(2)?,
                status: r.get(3)?,
                username: r.get(4)?,
                email: r.get(5)?,
                website_url: r.get(6)?,
                login_url: r.get(7)?,
                publisher: r.get(8)?,
                region: r.get(9)?,
                player_id: r.get(10)?,
                display_name: r.get(11)?,
                notes: r.get(12)?,
                identity_id: r.get(13)?,
                platform_id: r.get(14)?,
                game_id: r.get(15)?,
            })
        },
    )
    .optional()
}

/// The stored password envelope and fingerprint. Outer `None`: no such account.
#[allow(clippy::type_complexity)]
pub fn password(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<Option<(Option<Vec<u8>>, Option<Vec<u8>>)>> {
    conn.query_row(
        "SELECT password_enc, password_fp FROM account WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

/// Stores (or with all `None`, removes) the password envelope and what's
/// derived from it. `changed_at` is only moved by the caller when the value
/// actually changed.
pub fn set_password(
    conn: &Connection,
    id: &str,
    enc: Option<&[u8]>,
    fingerprint: Option<&[u8]>,
    strength: Option<u8>,
    changed_at: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE account SET password_enc = ?2, password_fp = ?3, password_strength = ?4,
            password_changed_at = ?5 WHERE id = ?1",
        params![id, enc, fingerprint, strength, changed_at],
    )?;
    Ok(())
}

/// The sensitive-notes envelope. Outer `None`: no such account.
pub fn sensitive_notes(conn: &Connection, id: &str) -> rusqlite::Result<Option<Option<Vec<u8>>>> {
    conn.query_row(
        "SELECT sensitive_notes_enc FROM account WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .optional()
}

/// Stores (or with `None`, removes) the sensitive-notes envelope with its
/// `notes_hints` flag bits, which also clears an earlier dismissal.
pub fn set_sensitive_notes(
    conn: &Connection,
    id: &str,
    enc: Option<&[u8]>,
    hints: u8,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE account SET sensitive_notes_enc = ?2, sensitive_notes_hints = ?3 WHERE id = ?1",
        params![id, enc, hints],
    )?;
    Ok(())
}

/// Keeps the sensitive notes as they are: no more suggestions until they
/// change. Not an edit, so `updated_at` stays.
pub fn dismiss_notes_hints(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET sensitive_notes_hints = sensitive_notes_hints | ?2 WHERE id = ?1",
        params![id, crate::domain::notes_hints::DISMISSED],
    )? == 1)
}

pub fn title(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT title FROM account WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()
}

/// The stored website or login URL. For the login URL, the second value is
/// the platform's catalog login page. Outer `None`: no such account.
#[allow(clippy::type_complexity)]
pub fn url(
    conn: &Connection,
    id: &str,
    login: bool,
) -> rusqlite::Result<Option<(Option<String>, Option<String>)>> {
    let sql = if login {
        "SELECT a.login_url, pl.default_login_url FROM account a
         LEFT JOIN platform pl ON pl.id = a.platform_id WHERE a.id = ?1"
    } else {
        "SELECT website_url, NULL FROM account WHERE id = ?1"
    };
    conn.query_row(sql, [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
}

/// Bumps `updated_at` (after a change to tags, custom fields or MFA).
pub fn touch(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )? == 1)
}

pub fn set_archived(
    conn: &Connection,
    id: &str,
    archived_at: Option<&str>,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET archived_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, archived_at, now],
    )? == 1)
}

/// Starring doesn't count as an edit, so `updated_at` stays.
pub fn set_favorite(
    conn: &Connection,
    id: &str,
    favorited_at: Option<&str>,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET favorite = ?2, favorited_at = ?3 WHERE id = ?1",
        params![id, favorited_at.is_some(), favorited_at],
    )? == 1)
}

/// The password was revealed or copied: the account is in use. Not an
/// edit, so `updated_at` stays.
pub fn set_used(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET last_used_at = ?2 WHERE id = ?1",
        params![id, now],
    )? == 1)
}

/// "Mark verified" is the user saying they checked the account still works;
/// it isn't an edit either.
pub fn set_verified(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE account SET last_verified_at = ?2 WHERE id = ?1",
        params![id, now],
    )? == 1)
}

/// Deletes the account; custom fields, tag links, MFA methods and game
/// profiles cascade (their search rows are removed here first).
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    unindex(conn, id)?;
    super::game_profile::unindex_for_account(conn, id)?;
    Ok(conn.execute("DELETE FROM account WHERE id = ?1", [id])? == 1)
}

fn split_tags(joined: Option<String>) -> Vec<String> {
    let mut tags: Vec<String> = joined
        .map(|s| s.split('\u{1f}').map(str::to_owned).collect())
        .unwrap_or_default();
    tags.sort_by_key(|t| t.to_lowercase());
    tags
}

fn count(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

const SUMMARY_SELECT: &str = "
    SELECT a.id, a.title, a.account_type, a.purpose_id, p.name, a.status, a.identity_id, i.name,
           a.username, a.email,
           a.publisher, a.password_enc IS NOT NULL, a.password_strength,
           EXISTS(SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1),
           (SELECT COALESCE(SUM(m.backup_codes_remaining), 0) FROM mfa_method m
             WHERE m.account_id = a.id AND m.enabled = 1),
           a.favorite, a.favorited_at, a.archived_at,
           (SELECT group_concat(t.name, char(31)) FROM account_tag x JOIN tag t ON t.id = x.tag_id
             WHERE x.account_id = a.id),
           a.updated_at,
           a.platform_id, pl.name, pl.icon, a.game_id, g.name, g.icon,
           max(a.updated_at, COALESCE(a.last_verified_at, ''), COALESCE(a.last_used_at, ''))
    FROM account a JOIN purpose_label p ON p.id = a.purpose_id
    LEFT JOIN identity i ON i.id = a.identity_id
    LEFT JOIN platform pl ON pl.id = a.platform_id
    LEFT JOIN game g ON g.id = a.game_id";

fn summary_row(r: &Row<'_>) -> rusqlite::Result<AccountSummary> {
    Ok(AccountSummary {
        id: r.get(0)?,
        title: r.get(1)?,
        account_type: r.get(2)?,
        purpose_id: r.get(3)?,
        purpose_name: r.get(4)?,
        status: r.get(5)?,
        identity_id: r.get(6)?,
        identity_name: r.get(7)?,
        username: r.get(8)?,
        email: r.get(9)?,
        platform_id: r.get(20)?,
        platform_name: r.get(21)?,
        platform_icon: r.get(22)?,
        game_id: r.get(23)?,
        game_name: r.get(24)?,
        game_icon: r.get(25)?,
        publisher: r.get(10)?,
        has_password: r.get(11)?,
        password_strength: r.get(12)?,
        mfa_enabled: r.get(13)?,
        backup_codes_remaining: count(r.get(14)?),
        favorite: r.get(15)?,
        favorited_at: r.get(16)?,
        archived_at: r.get(17)?,
        tags: split_tags(r.get(18)?),
        updated_at: r.get(19)?,
        last_activity_at: r.get(26)?,
    })
}

/// Active (`archived` false) or archived accounts matching `filter`, by
/// title. A game filter also matches accounts with a profile for that game.
pub fn summaries(
    conn: &Connection,
    archived: bool,
    filter: &AccountFilter,
) -> rusqlite::Result<Vec<AccountSummary>> {
    let sql = format!(
        "{SUMMARY_SELECT} WHERE (a.archived_at IS NOT NULL) = ?1
           AND (?2 IS NULL OR a.platform_id = ?2)
           AND (?3 IS NULL OR a.game_id = ?3
                OR EXISTS(SELECT 1 FROM game_profile gp
                          WHERE gp.account_id = a.id AND gp.game_id = ?3))
           AND (?4 IS NULL OR trim(a.publisher) = ?4 COLLATE NOCASE)
         ORDER BY a.title COLLATE NOCASE, a.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![
            archived,
            filter.platform_id,
            filter.game_id,
            filter.publisher.as_deref().map(str::trim)
        ],
        summary_row,
    )?;
    rows.collect()
}

/// The `limit` most recently edited active accounts, optionally only one
/// identity's.
pub fn recent(
    conn: &Connection,
    identity_id: Option<&str>,
    limit: u32,
) -> rusqlite::Result<Vec<AccountSummary>> {
    let sql = format!(
        "{SUMMARY_SELECT} WHERE a.archived_at IS NULL AND (?1 IS NULL OR a.identity_id = ?1)
         ORDER BY a.updated_at DESC, a.id DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![identity_id, limit], summary_row)?;
    rows.collect()
}

/// Dashboard counts over active accounts, optionally only one identity's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub total: u32,
    pub main: u32,
    pub alt: u32,
    pub missing_mfa: u32,
    pub favorites: u32,
}

pub fn counts(conn: &Connection, identity_id: Option<&str>) -> rusqlite::Result<Counts> {
    conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(p.slug = 'main'), 0),
                COALESCE(SUM(p.slug = 'alt'), 0),
                COALESCE(SUM(NOT EXISTS(SELECT 1 FROM mfa_method m
                                         WHERE m.account_id = a.id AND m.enabled = 1)), 0),
                COALESCE(SUM(a.favorite), 0)
         FROM account a JOIN purpose_label p ON p.id = a.purpose_id
         WHERE a.archived_at IS NULL AND (?1 IS NULL OR a.identity_id = ?1)",
        [identity_id],
        |r| {
            Ok(Counts {
                total: count(r.get(0)?),
                main: count(r.get(1)?),
                alt: count(r.get(2)?),
                missing_mfa: count(r.get(3)?),
                favorites: count(r.get(4)?),
            })
        },
    )
}

pub fn summary(conn: &Connection, id: &str) -> rusqlite::Result<Option<AccountSummary>> {
    let sql = format!("{SUMMARY_SELECT} WHERE a.id = ?1");
    conn.query_row(&sql, [id], summary_row).optional()
}

/// The detail view without MFA (the service adds it, since backup-code
/// slots come from decrypting).
pub fn detail(conn: &Connection, id: &str) -> rusqlite::Result<Option<AccountDetail>> {
    let found = conn
        .query_row(
            "SELECT a.id, a.title, a.account_type, a.purpose_id, p.name, a.status, a.username,
                    a.email, a.password_enc IS NOT NULL, a.password_strength, a.password_changed_at,
                    a.website_url, a.login_url, a.publisher, a.region, a.player_id, a.display_name,
                    a.notes, a.sensitive_notes_enc IS NOT NULL, a.favorite, a.archived_at,
                    a.last_verified_at, a.created_at, a.updated_at, a.identity_id, i.name,
                    CASE WHEN a.login_url IS NULL THEN pl.default_login_url END,
                    a.platform_id, pl.name, pl.icon, a.game_id, g.name, g.icon,
                    a.sensitive_notes_hints, a.last_used_at,
                    max(a.updated_at, COALESCE(a.last_verified_at, ''), COALESCE(a.last_used_at, ''))
             FROM account a JOIN purpose_label p ON p.id = a.purpose_id
             LEFT JOIN identity i ON i.id = a.identity_id
             LEFT JOIN platform pl ON pl.id = a.platform_id
             LEFT JOIN game g ON g.id = a.game_id
             WHERE a.id = ?1",
            [id],
            |r| {
                Ok(AccountDetail {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    account_type: r.get(2)?,
                    purpose_id: r.get(3)?,
                    purpose_name: r.get(4)?,
                    status: r.get(5)?,
                    identity_id: r.get(24)?,
                    identity_name: r.get(25)?,
                    username: r.get(6)?,
                    email: r.get(7)?,
                    recovery_email: None,
                    recovery_phone: None,
                    has_password: r.get(8)?,
                    password_strength: r.get(9)?,
                    password_changed_at: r.get(10)?,
                    website_url: r.get(11)?,
                    login_url: r.get(12)?,
                    catalog_login_url: r.get(26)?,
                    platform_id: r.get(27)?,
                    platform_name: r.get(28)?,
                    platform_icon: r.get(29)?,
                    game_id: r.get(30)?,
                    game_name: r.get(31)?,
                    game_icon: r.get(32)?,
                    publisher: r.get(13)?,
                    region: r.get(14)?,
                    player_id: r.get(15)?,
                    display_name: r.get(16)?,
                    notes: r.get(17)?,
                    has_sensitive_notes: r.get(18)?,
                    notes_suggestions: NotesSuggestions::from_bits(r.get(33)?),
                    favorite: r.get(19)?,
                    archived_at: r.get(20)?,
                    last_verified_at: r.get(21)?,
                    last_used_at: r.get(34)?,
                    last_activity_at: r.get(35)?,
                    created_at: r.get(22)?,
                    updated_at: r.get(23)?,
                    tags: Vec::new(),
                    custom_fields: Vec::new(),
                    mfa: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut detail) = found else {
        return Ok(None);
    };
    detail.tags = super::tag::for_account(conn, id)?;
    detail.recovery_email = super::contact::account_value(conn, id, ContactRole::RecoveryEmail)?;
    detail.recovery_phone = super::contact::account_value(conn, id, ContactRole::RecoveryPhone)?;
    detail.custom_fields = custom_field_views(conn, id)?;
    Ok(Some(detail))
}

// ---- Custom fields --------------------------------------------------------

/// A custom field as stored. `value_enc` is set only for `Secret` fields.
#[derive(Clone, PartialEq, Eq)]
pub struct CustomFieldRow {
    pub id: String,
    pub label: String,
    pub field_type: CustomFieldType,
    pub value_text: Option<String>,
    pub value_enc: Option<Vec<u8>>,
}

impl std::fmt::Debug for CustomFieldRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CustomFieldRow")
            .field("id", &self.id)
            .field("field_type", &self.field_type)
            .finish_non_exhaustive()
    }
}

pub fn custom_fields(conn: &Connection, account_id: &str) -> rusqlite::Result<Vec<CustomFieldRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, label, field_type, value_text, value_enc FROM account_custom_field
         WHERE account_id = ?1 ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([account_id], |r| {
        Ok(CustomFieldRow {
            id: r.get(0)?,
            label: r.get(1)?,
            field_type: r.get(2)?,
            value_text: r.get(3)?,
            value_enc: r.get(4)?,
        })
    })?;
    rows.collect()
}

fn custom_field_views(
    conn: &Connection,
    account_id: &str,
) -> rusqlite::Result<Vec<CustomFieldView>> {
    Ok(custom_fields(conn, account_id)?
        .into_iter()
        .map(|f| CustomFieldView {
            has_value: f.value_text.is_some() || f.value_enc.is_some(),
            value: if f.field_type == CustomFieldType::Secret {
                None
            } else {
                f.value_text.clone()
            },
            id: f.id.clone(),
            label: f.label.clone(),
            field_type: f.field_type,
        })
        .collect())
}

/// Replaces an account's custom fields with `rows`, in order. Ids are kept,
/// so an unchanged secret's envelope (bound to its row id) stays valid.
pub fn replace_custom_fields(
    conn: &Connection,
    account_id: &str,
    rows: &[CustomFieldRow],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM account_custom_field WHERE account_id = ?1",
        [account_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO account_custom_field (id, account_id, label, field_type, value_text, value_enc, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (i, f) in rows.iter().enumerate() {
        stmt.execute(params![
            f.id,
            account_id,
            f.label,
            f.field_type,
            f.value_text,
            f.value_enc,
            i64::try_from(i).unwrap_or(i64::MAX)
        ])?;
    }
    Ok(())
}

/// A secret custom field's envelope. Outer `None`: no such secret field.
pub fn custom_field_secret(
    conn: &Connection,
    field_id: &str,
) -> rusqlite::Result<Option<Option<Vec<u8>>>> {
    conn.query_row(
        "SELECT value_enc FROM account_custom_field WHERE id = ?1 AND field_type = 'secret'",
        [field_id],
        |r| r.get(0),
    )
    .optional()
}

// ---- Search index -----------------------------------------------------------

/// Rewrites the account's search row from the tables. Never includes a
/// secret column: passwords, sensitive notes, secret custom fields and MFA
/// data stay out of the index.
pub fn reindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    unindex(conn, id)?;
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, title, username, email, game, platform,
            publisher, tags, identity, purpose, notes, region, player_id)
         SELECT 'account', a.id, a.title, COALESCE(a.username, ''), COALESCE(a.email, ''),
                COALESCE(g.name, ''), COALESCE(pl.name, ''), COALESCE(a.publisher, ''),
                COALESCE((SELECT group_concat(t.name, ' ') FROM account_tag x
                          JOIN tag t ON t.id = x.tag_id WHERE x.account_id = a.id), ''),
                COALESCE(i.name, ''), p.name, COALESCE(a.notes, ''), COALESCE(a.region, ''),
                COALESCE(a.player_id, '')
         FROM account a
         JOIN purpose_label p ON p.id = a.purpose_id
         LEFT JOIN game g ON g.id = a.game_id
         LEFT JOIN platform pl ON pl.id = a.platform_id
         LEFT JOIN identity i ON i.id = a.identity_id
         WHERE a.id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn unindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = 'account' AND entity_id = ?1",
        [id],
    )?;
    Ok(())
}
