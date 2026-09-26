//! Accounts: create, edit, archive, favorite, verify, duplicate, delete, and
//! the secrets on them.
//!
//! Every write runs in one transaction together with its search-index
//! update. Secrets arrive as `SecretUpdate`s, are sealed as field envelopes
//! bound to their cell, and only leave through `reveal` (and the clipboard
//! copy built on it). Strength and fingerprint are computed here, at write
//! time, so the UI never needs the value to show them.

use rusqlite::Connection;
use secrecy::SecretString;
use zeroize::Zeroizing;

use crate::clock::Clock;
use crate::crypto::fingerprint::password_fingerprint;
use crate::crypto::keys::VaultKeys;
use crate::crypto::password::strength;
use crate::db::repo::account::{self as repo, AccountFields, CustomFieldRow};
use crate::db::repo::{contact, identity, new_id, open_text, purpose, seal, tag};
use crate::domain::account::{
    AccountDetail, AccountInput, AccountStatus, AccountSummary, AccountUrl, CustomFieldInput,
    CustomFieldType, PurposeView, SecretRef, SecretUpdate, UrlTarget,
};
use crate::domain::identity::{ContactKind, ContactRole};
use crate::domain::validation::{
    self as v, MAX_NOTES_CHARS, MAX_SECRET_CHARS, MAX_SHORT_CHARS, MAX_TITLE_CHARS,
};
use crate::service::mfa;
use crate::vault::OpenVault;
use crate::AppError;

pub const MAX_CUSTOM_FIELDS: usize = 50;
const MAX_LABEL_CHARS: usize = 100;
const MAX_FIELD_VALUE_CHARS: usize = 4000;

const TABLE: &str = "account";
const PASSWORD_COL: &str = "password_enc";
const NOTES_COL: &str = "sensitive_notes_enc";
const FIELD_TABLE: &str = "account_custom_field";
const FIELD_COL: &str = "value_enc";

fn not_found<T>(value: Option<T>) -> Result<T, AppError> {
    value.ok_or(AppError::NotFound)
}

// ---- Reads -------------------------------------------------------------------

pub fn purposes(vault: &OpenVault) -> Result<Vec<PurposeView>, AppError> {
    Ok(purpose::list_visible(vault.conn())?)
}

pub fn tags(vault: &OpenVault) -> Result<Vec<String>, AppError> {
    Ok(tag::list(vault.conn())?)
}

/// Active accounts, or archived ones.
pub fn list(vault: &OpenVault, archived: bool) -> Result<Vec<AccountSummary>, AppError> {
    Ok(repo::summaries(vault.conn(), archived)?)
}

pub fn get(vault: &OpenVault, id: &str) -> Result<AccountDetail, AppError> {
    detail(vault.conn(), vault.keys(), id)
}

pub(crate) fn detail(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
) -> Result<AccountDetail, AppError> {
    let mut d = not_found(repo::detail(conn, id)?)?;
    d.mfa = mfa::views(conn, keys, id)?;
    Ok(d)
}

// ---- Validation --------------------------------------------------------------

fn validate_fields(conn: &Connection, input: &AccountInput) -> Result<AccountFields, AppError> {
    if !purpose::exists(conn, &input.purpose_id)? {
        return Err(AppError::InvalidInput { field: "purposeId" });
    }
    let identity_id = match input.identity_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(id) => {
            if identity::archived(conn, id)?.is_none() {
                return Err(AppError::InvalidInput {
                    field: "identityId",
                });
            }
            Some(id.to_owned())
        }
    };
    Ok(AccountFields {
        title: v::required(&input.title, "title", MAX_TITLE_CHARS)?,
        account_type: input.account_type,
        purpose_id: input.purpose_id.clone(),
        status: input.status,
        identity_id,
        username: v::optional(input.username.as_deref(), "username", MAX_SHORT_CHARS)?,
        email: v::optional_email(input.email.as_deref(), "email")?,
        website_url: v::optional_web_url(input.website_url.as_deref(), "websiteUrl")?,
        login_url: v::optional_web_url(input.login_url.as_deref(), "loginUrl")?,
        publisher: v::optional(input.publisher.as_deref(), "publisher", MAX_SHORT_CHARS)?,
        region: v::optional(input.region.as_deref(), "region", MAX_SHORT_CHARS)?,
        player_id: v::optional(input.player_id.as_deref(), "playerId", MAX_SHORT_CHARS)?,
        display_name: v::optional(
            input.display_name.as_deref(),
            "displayName",
            MAX_SHORT_CHARS,
        )?,
        notes: v::optional_multiline(input.notes.as_deref(), "notes", MAX_NOTES_CHARS)?,
    })
}

/// The recovery contacts the form sends, validated.
struct RecoveryContacts {
    email: Option<String>,
    phone: Option<String>,
}

fn validate_recovery(input: &AccountInput) -> Result<RecoveryContacts, AppError> {
    Ok(RecoveryContacts {
        email: v::optional_email(input.recovery_email.as_deref(), "recoveryEmail")?,
        phone: v::optional(
            input.recovery_phone.as_deref(),
            "recoveryPhone",
            MAX_SHORT_CHARS,
        )?,
    })
}

/// Links the account to contact points for its login email, recovery email
/// and recovery phone (upserting them), then drops contact points nothing
/// uses any more.
fn sync_contacts(
    conn: &Connection,
    id: &str,
    login_email: Option<&str>,
    recovery: &RecoveryContacts,
    now: &str,
) -> Result<(), AppError> {
    let links = [
        (ContactRole::LoginEmail, ContactKind::Email, login_email),
        (
            ContactRole::RecoveryEmail,
            ContactKind::Email,
            recovery.email.as_deref(),
        ),
        (
            ContactRole::RecoveryPhone,
            ContactKind::Phone,
            recovery.phone.as_deref(),
        ),
    ];
    for (role, kind, value) in links {
        let cid = value
            .map(|v| contact::upsert(conn, kind, v, now))
            .transpose()?;
        contact::set_account_role(conn, id, role, cid.as_deref())?;
    }
    contact::prune_unused(conn)?;
    Ok(())
}

/// A password is taken as typed (spaces are allowed and kept), but it can't
/// be empty, huge, or contain control characters.
fn check_password(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.chars().count() > MAX_SECRET_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(AppError::InvalidInput { field: "password" });
    }
    Ok(())
}

fn check_sensitive_notes(update: &SecretUpdate) -> Result<(), AppError> {
    if let SecretUpdate::Set { value } = update {
        v::optional_multiline(Some(value), "sensitiveNotes", MAX_NOTES_CHARS)?;
    }
    Ok(())
}

fn custom_value(input: &CustomFieldInput) -> Result<Option<String>, AppError> {
    const FIELD: &str = "customFields";
    let raw = input.value.as_deref();
    let bad = || AppError::InvalidInput { field: FIELD };
    match input.field_type {
        CustomFieldType::Secret => Ok(None),
        CustomFieldType::Text => v::optional_multiline(raw, FIELD, MAX_FIELD_VALUE_CHARS),
        CustomFieldType::Url => v::optional_web_url(raw, FIELD),
        CustomFieldType::Email => v::optional_email(raw, FIELD),
        CustomFieldType::Number => {
            let value = v::optional(raw, FIELD, 64)?;
            if let Some(n) = &value {
                if !n.parse::<f64>().is_ok_and(f64::is_finite) {
                    return Err(bad());
                }
            }
            Ok(value)
        }
        CustomFieldType::Date => {
            let value = v::optional(raw, FIELD, 10)?;
            if let Some(d) = &value {
                if !is_iso_date(d) {
                    return Err(bad());
                }
            }
            Ok(value)
        }
    }
}

/// `YYYY-MM-DD` naming a real calendar day.
fn is_iso_date(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    let [y, m, d] = parts.as_slice() else {
        return false;
    };
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (y.parse::<i32>(), m.parse::<u8>(), d.parse::<u8>())
    else {
        return false;
    };
    time::Month::try_from(month)
        .ok()
        .and_then(|month| time::Date::from_calendar_date(year, month, day).ok())
        .is_some()
}

/// Turns the form's custom fields into rows. Existing ids must belong to
/// this account; an unchanged secret keeps its envelope (bound to the same
/// row id).
fn plan_custom_fields(
    keys: &VaultKeys,
    inputs: &[CustomFieldInput],
    existing: &[CustomFieldRow],
) -> Result<Vec<CustomFieldRow>, AppError> {
    const FIELD: &str = "customFields";
    if inputs.len() > MAX_CUSTOM_FIELDS {
        return Err(AppError::InvalidInput { field: FIELD });
    }
    let mut rows = Vec::with_capacity(inputs.len());
    for input in inputs {
        let label = v::required(&input.label, FIELD, MAX_LABEL_CHARS)?;
        let previous = match &input.id {
            Some(id) => Some(
                existing
                    .iter()
                    .find(|f| &f.id == id)
                    .ok_or(AppError::InvalidInput { field: FIELD })?,
            ),
            None => None,
        };
        if rows
            .iter()
            .any(|r: &CustomFieldRow| Some(&r.id) == input.id.as_ref())
        {
            return Err(AppError::InvalidInput { field: FIELD });
        }
        let id = input.id.clone().unwrap_or_else(new_id);
        let (value_text, value_enc) = if input.field_type == CustomFieldType::Secret {
            let enc = match &input.secret {
                SecretUpdate::Unchanged => previous
                    .filter(|p| p.field_type == CustomFieldType::Secret)
                    .and_then(|p| p.value_enc.clone()),
                SecretUpdate::Clear => None,
                SecretUpdate::Set { value } if value.is_empty() => None,
                SecretUpdate::Set { value } => {
                    if value.chars().count() > MAX_SECRET_CHARS
                        || value
                            .chars()
                            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                    {
                        return Err(AppError::InvalidInput { field: FIELD });
                    }
                    Some(seal(keys, FIELD_TABLE, FIELD_COL, &id, value.as_bytes())?)
                }
            };
            (None, enc)
        } else {
            (custom_value(input)?, None)
        };
        rows.push(CustomFieldRow {
            id,
            label,
            field_type: input.field_type,
            value_text,
            value_enc,
        });
    }
    Ok(rows)
}

// ---- Secret writes -----------------------------------------------------------

/// Applies a password update. `password_changed_at` moves only when the value
/// actually changes (compared by fingerprint, so nothing is decrypted).
fn apply_password(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
    update: &SecretUpdate,
    now: &str,
) -> Result<(), AppError> {
    match update {
        SecretUpdate::Unchanged => Ok(()),
        SecretUpdate::Clear => Ok(repo::set_password(conn, id, None, None, None, None)?),
        SecretUpdate::Set { value } => {
            check_password(value)?;
            let secret = SecretString::from(value.clone());
            let fp = password_fingerprint(keys.fingerprint_key(), &secret);
            let (_, old_fp) = not_found(repo::password(conn, id)?)?;
            if old_fp.as_deref() == Some(fp.as_slice()) {
                return Ok(());
            }
            let enc = seal(keys, TABLE, PASSWORD_COL, id, value.as_bytes())?;
            repo::set_password(
                conn,
                id,
                Some(&enc),
                Some(&fp),
                Some(strength(&secret)),
                Some(now),
            )?;
            Ok(())
        }
    }
}

fn apply_sensitive_notes(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
    update: &SecretUpdate,
) -> Result<(), AppError> {
    match update {
        SecretUpdate::Unchanged => Ok(()),
        SecretUpdate::Clear => Ok(repo::set_sensitive_notes(conn, id, None)?),
        SecretUpdate::Set { value } => {
            match v::optional_multiline(Some(value), "sensitiveNotes", MAX_NOTES_CHARS)? {
                None => repo::set_sensitive_notes(conn, id, None)?,
                Some(text) => {
                    let text = Zeroizing::new(text);
                    let enc = seal(keys, TABLE, NOTES_COL, id, text.as_bytes())?;
                    repo::set_sensitive_notes(conn, id, Some(&enc))?;
                }
            }
            Ok(())
        }
    }
}

// ---- Writes ------------------------------------------------------------------

pub fn create(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &AccountInput,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let (conn, keys) = vault.conn_and_keys();
    let tx = conn.transaction()?;
    let fields = validate_fields(&tx, input)?;
    let recovery = validate_recovery(input)?;
    let tags = v::tags(&input.tags)?;
    check_sensitive_notes(&input.sensitive_notes)?;
    let custom = plan_custom_fields(keys, &input.custom_fields, &[])?;

    repo::insert(&tx, &id, &fields, &now)?;
    apply_password(&tx, keys, &id, &input.password, &now)?;
    apply_sensitive_notes(&tx, keys, &id, &input.sensitive_notes)?;
    tag::set_for_account(&tx, &id, &tags)?;
    repo::replace_custom_fields(&tx, &id, &custom)?;
    sync_contacts(&tx, &id, fields.email.as_deref(), &recovery, &now)?;
    repo::reindex(&tx, &id)?;
    tx.commit()?;
    tracing::info!(account = %id, "account created");
    detail(vault.conn(), vault.keys(), &id)
}

pub fn update(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &AccountInput,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let (conn, keys) = vault.conn_and_keys();
    let tx = conn.transaction()?;
    let fields = validate_fields(&tx, input)?;
    let recovery = validate_recovery(input)?;
    let tags = v::tags(&input.tags)?;
    check_sensitive_notes(&input.sensitive_notes)?;
    let existing = repo::custom_fields(&tx, id)?;
    let custom = plan_custom_fields(keys, &input.custom_fields, &existing)?;

    if !repo::update_fields(&tx, id, &fields, &now)? {
        return Err(AppError::NotFound);
    }
    apply_password(&tx, keys, id, &input.password, &now)?;
    apply_sensitive_notes(&tx, keys, id, &input.sensitive_notes)?;
    tag::set_for_account(&tx, id, &tags)?;
    tag::prune_unused(&tx)?;
    repo::replace_custom_fields(&tx, id, &custom)?;
    sync_contacts(&tx, id, fields.email.as_deref(), &recovery, &now)?;
    repo::reindex(&tx, id)?;
    tx.commit()?;
    tracing::info!(account = %id, "account updated");
    detail(vault.conn(), vault.keys(), id)
}

pub fn set_archived(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    archived: bool,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let archived_at = archived.then_some(now.as_str());
    if !repo::set_archived(vault.conn(), id, archived_at, &now)? {
        return Err(AppError::NotFound);
    }
    tracing::info!(account = %id, archived, "account archive state changed");
    get(vault, id)
}

pub fn set_favorite(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    favorite: bool,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    if !repo::set_favorite(vault.conn(), id, favorite.then_some(now.as_str()))? {
        return Err(AppError::NotFound);
    }
    get(vault, id)
}

/// Records that the user checked the account still works. Manual only:
/// Vaultair never logs in anywhere to verify (ADR-0004).
pub fn mark_verified(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
) -> Result<AccountDetail, AppError> {
    if !repo::set_verified(vault.conn(), id, &clock.now_rfc3339())? {
        return Err(AppError::NotFound);
    }
    get(vault, id)
}

/// Permanently deletes an account. `confirm_title` must match its title:
/// the UI makes the user type it, and the backend checks it, so a stray call
/// can't delete anything.
pub fn delete(vault: &mut OpenVault, id: &str, confirm_title: &str) -> Result<(), AppError> {
    let conn = vault.conn_mut();
    let tx = conn.transaction()?;
    let title = not_found(repo::title(&tx, id)?)?;
    if confirm_title.trim() != title.trim() {
        return Err(AppError::InvalidInput {
            field: "confirmTitle",
        });
    }
    repo::delete(&tx, id)?;
    tag::prune_unused(&tx)?;
    contact::prune_unused(&tx)?;
    tx.commit()?;
    tracing::info!(account = %id, "account deleted");
    Ok(())
}

/// "Duplicate as alt template": a new account on the same platform and game
/// with the same publisher, region, URLs, identity, tags and custom-field
/// labels, but none of the credentials. Username, email, password, recovery
/// contacts, player ID, display name, notes, custom-field values and MFA are
/// left empty.
pub fn duplicate_as_template(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let new = new_id();
    let conn = vault.conn_mut();
    let tx = conn.transaction()?;
    let source = not_found(repo::fields(&tx, id)?)?;
    let alt_purpose = purpose::id_by_slug(&tx, "alt")?;
    let mut title: String = source.title.clone();
    let suffix = " (alt)";
    let keep = MAX_TITLE_CHARS - suffix.chars().count();
    if title.chars().count() > keep {
        title = title.chars().take(keep).collect();
    }
    title.push_str(suffix);

    let fields = AccountFields {
        title,
        purpose_id: alt_purpose.unwrap_or(source.purpose_id),
        status: AccountStatus::Active,
        username: None,
        email: None,
        player_id: None,
        display_name: None,
        notes: None,
        ..source
    };
    repo::insert(&tx, &new, &fields, &now)?;
    repo::copy_links(&tx, id, &new)?;
    let labels: Vec<CustomFieldRow> = repo::custom_fields(&tx, id)?
        .into_iter()
        .map(|f| CustomFieldRow {
            id: new_id(),
            label: f.label.clone(),
            field_type: f.field_type,
            value_text: None,
            value_enc: None,
        })
        .collect();
    repo::replace_custom_fields(&tx, &new, &labels)?;
    tag::set_for_account(&tx, &new, &tag::for_account(&tx, id)?)?;
    repo::reindex(&tx, &new)?;
    tx.commit()?;
    tracing::info!(account = %new, source = %id, "account duplicated as a template");
    get(vault, &new)
}

/// The stored website or login URL, validated again (it could predate a
/// stricter rule, or have been edited outside the app), with its host for
/// the confirm dialog.
pub fn url_target(vault: &OpenVault, id: &str, which: AccountUrl) -> Result<UrlTarget, AppError> {
    let stored = not_found(repo::url(vault.conn(), id, which == AccountUrl::Login)?)?;
    let stored = stored.ok_or(AppError::NotFound)?;
    let url = v::web_url(&stored, "url")?;
    let host = v::host_of(&url).ok_or(AppError::InvalidInput { field: "url" })?;
    Ok(UrlTarget { url, host })
}

// ---- Secret reads ------------------------------------------------------------

/// Decrypts one secret for reveal or copy. Every call is logged by kind,
/// never by value.
pub fn reveal(
    vault: &OpenVault,
    clock: &dyn Clock,
    target: &SecretRef,
) -> Result<Zeroizing<String>, AppError> {
    let conn = vault.conn();
    let keys = vault.keys();
    let value = match target {
        SecretRef::AccountPassword { id } => {
            let (enc, _) = not_found(repo::password(conn, id)?)?;
            open_text(keys, TABLE, PASSWORD_COL, id, &not_found(enc)?)?
        }
        SecretRef::SensitiveNotes { id } => {
            let enc = not_found(not_found(repo::sensitive_notes(conn, id)?)?)?;
            open_text(keys, TABLE, NOTES_COL, id, &enc)?
        }
        SecretRef::CustomField { id } => {
            let enc = not_found(not_found(repo::custom_field_secret(conn, id)?)?)?;
            open_text(keys, FIELD_TABLE, FIELD_COL, id, &enc)?
        }
        SecretRef::TotpSecret { id } => mfa::totp_secret(conn, keys, id)?,
        SecretRef::TotpCode { id } => {
            let code = mfa::current_code(conn, keys, clock, id)?;
            Zeroizing::new(code.code.clone())
        }
        SecretRef::RecoveryInstructions { id } => mfa::recovery_instructions(conn, keys, id)?,
        SecretRef::BackupCode { id, index } => mfa::backup_code(conn, keys, id, *index)?,
    };
    tracing::info!(kind = target.kind(), "secret decrypted for reveal or copy");
    Ok(value)
}
