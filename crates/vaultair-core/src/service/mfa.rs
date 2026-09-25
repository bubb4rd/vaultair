//! MFA methods on an account: TOTP keys and codes, backup codes and recovery
//! instructions. All three are field envelopes on `mfa_method`.
//!
//! Backup codes are stored as one envelope holding `[{code, used}]`. Marking
//! a code used rewrites that envelope (new nonce), and `backup_codes_remaining`
//! is kept alongside so lists and health checks never decrypt.

use rusqlite::Connection;
use zeroize::Zeroizing;

use crate::clock::Clock;
use crate::crypto::keys::VaultKeys;
use crate::crypto::totp;
use crate::db::repo::account as account_repo;
use crate::db::repo::mfa::{self as repo, MfaRow};
use crate::db::repo::{new_id, open, open_text, seal};
use crate::domain::account::{AccountDetail, BackupCodeSlot, MfaView, SecretUpdate, TotpCodeView};
use crate::domain::mfa::{parse_backup_codes, BackupCode, MfaInput, TotpAlgorithm};
use crate::domain::validation::{self as v, MAX_NOTES_CHARS};
use crate::service::accounts;
use crate::vault::OpenVault;
use crate::AppError;

const TABLE: &str = "mfa_method";
const TOTP_COL: &str = "totp_secret_enc";
const CODES_COL: &str = "backup_codes_enc";
const RECOVERY_COL: &str = "recovery_instructions_enc";

fn get(conn: &Connection, id: &str) -> Result<MfaRow, AppError> {
    repo::get(conn, id)?.ok_or(AppError::NotFound)
}

fn decrypt_codes(keys: &VaultKeys, row: &MfaRow) -> Result<Vec<BackupCode>, AppError> {
    let Some(enc) = &row.backup_codes_enc else {
        return Ok(Vec::new());
    };
    let json = open(keys, TABLE, CODES_COL, &row.id, enc)?;
    serde_json::from_slice(&json).map_err(|_| {
        tracing::error!("backup codes envelope holds invalid data");
        AppError::VaultCorrupted
    })
}

fn seal_codes(keys: &VaultKeys, id: &str, codes: &[BackupCode]) -> Result<Vec<u8>, AppError> {
    let json = Zeroizing::new(
        serde_json::to_vec(codes).map_err(|_| AppError::Internal { context: "encode" })?,
    );
    seal(keys, TABLE, CODES_COL, id, &json)
}

fn remaining(codes: &[BackupCode]) -> u32 {
    u32::try_from(codes.iter().filter(|c| !c.used).count()).unwrap_or(u32::MAX)
}

/// An account's methods as the detail page shows them: flags and backup-code
/// slots, no secrets.
pub(crate) fn views(
    conn: &Connection,
    keys: &VaultKeys,
    account_id: &str,
) -> Result<Vec<MfaView>, AppError> {
    repo::for_account(conn, account_id)?
        .into_iter()
        .map(|row| {
            let codes = decrypt_codes(keys, &row)?;
            Ok(MfaView {
                backup_codes: codes
                    .iter()
                    .enumerate()
                    .map(|(i, c)| BackupCodeSlot {
                        index: u32::try_from(i).unwrap_or(u32::MAX),
                        used: c.used,
                    })
                    .collect(),
                has_totp: row.totp_secret_enc.is_some(),
                totp_digits: row.totp_secret_enc.as_ref().and(row.totp_digits),
                totp_period: row.totp_secret_enc.as_ref().and(row.totp_period),
                has_recovery_instructions: row.recovery_instructions_enc.is_some(),
                id: row.id.clone(),
                method: row.method,
                enabled: row.enabled,
                backup_codes_remaining: row.backup_codes_remaining,
                backup_codes_updated_at: row.backup_codes_updated_at.clone(),
                notes: row.notes.clone(),
                updated_at: row.updated_at.clone(),
            })
        })
        .collect()
}

// ---- Secret reads (via `accounts::reveal`) -----------------------------------

pub(crate) fn totp_secret(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
) -> Result<Zeroizing<String>, AppError> {
    let row = get(conn, id)?;
    let enc = row.totp_secret_enc.as_ref().ok_or(AppError::NotFound)?;
    open_text(keys, TABLE, TOTP_COL, id, enc)
}

pub(crate) fn current_code(
    conn: &Connection,
    keys: &VaultKeys,
    clock: &dyn Clock,
    id: &str,
) -> Result<TotpCodeView, AppError> {
    let row = get(conn, id)?;
    let enc = row.totp_secret_enc.as_ref().ok_or(AppError::NotFound)?;
    let base32 = open_text(keys, TABLE, TOTP_COL, id, enc)?;
    let secret = totp::base32_decode(&base32).ok_or(AppError::VaultCorrupted)?;
    let algorithm = row.totp_algorithm.unwrap_or(TotpAlgorithm::Sha1);
    let digits = row.totp_digits.unwrap_or(totp::DEFAULT_DIGITS);
    let period = row.totp_period.unwrap_or(totp::DEFAULT_PERIOD);
    let now = clock.now_utc().unix_timestamp();
    let code = totp::code(&secret, algorithm, digits, period, now);
    Ok(TotpCodeView {
        code: code.as_str().to_owned(),
        seconds_remaining: totp::seconds_remaining(period, now),
        period,
    })
}

pub(crate) fn recovery_instructions(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
) -> Result<Zeroizing<String>, AppError> {
    let row = get(conn, id)?;
    let enc = row
        .recovery_instructions_enc
        .as_ref()
        .ok_or(AppError::NotFound)?;
    open_text(keys, TABLE, RECOVERY_COL, id, enc)
}

pub(crate) fn backup_code(
    conn: &Connection,
    keys: &VaultKeys,
    id: &str,
    index: u32,
) -> Result<Zeroizing<String>, AppError> {
    let row = get(conn, id)?;
    let codes = decrypt_codes(keys, &row)?;
    let code = usize::try_from(index)
        .ok()
        .and_then(|i| codes.get(i))
        .ok_or(AppError::NotFound)?;
    Ok(Zeroizing::new(code.code.clone()))
}

/// The current code with its countdown, for the detail page.
pub fn totp_code(vault: &OpenVault, clock: &dyn Clock, id: &str) -> Result<TotpCodeView, AppError> {
    let code = current_code(vault.conn(), vault.keys(), clock, id)?;
    tracing::info!(kind = "totp code", "secret decrypted for reveal or copy");
    Ok(code)
}

// ---- Writes --------------------------------------------------------------------

/// Adds an MFA method to an account, or edits one (`input.id`).
pub fn upsert(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    account_id: &str,
    input: &MfaInput,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let notes = v::optional_multiline(input.notes.as_deref(), "notes", MAX_NOTES_CHARS)?;
    let (conn, keys) = vault.conn_and_keys();
    let tx = conn.transaction()?;
    if account_repo::title(&tx, account_id)?.is_none() {
        return Err(AppError::NotFound);
    }
    let mut row = match &input.id {
        Some(id) => {
            let row = get(&tx, id)?;
            if row.account_id != account_id {
                return Err(AppError::NotFound);
            }
            row
        }
        None => MfaRow {
            id: new_id(),
            account_id: account_id.to_owned(),
            method: input.method,
            enabled: input.enabled,
            totp_secret_enc: None,
            totp_algorithm: None,
            totp_digits: None,
            totp_period: None,
            backup_codes_enc: None,
            backup_codes_remaining: 0,
            backup_codes_updated_at: None,
            recovery_instructions_enc: None,
            notes: None,
            updated_at: now.clone(),
        },
    };
    row.method = input.method;
    row.enabled = input.enabled;
    row.notes = notes;
    row.updated_at.clone_from(&now);

    match &input.totp_secret {
        SecretUpdate::Unchanged => {}
        SecretUpdate::Set { value } if value.trim().is_empty() => {}
        SecretUpdate::Clear => {
            row.totp_secret_enc = None;
            row.totp_algorithm = None;
            row.totp_digits = None;
            row.totp_period = None;
        }
        SecretUpdate::Set { value } => {
            let setup = totp::parse_setup(value)?;
            row.totp_secret_enc = Some(seal(
                keys,
                TABLE,
                TOTP_COL,
                &row.id,
                setup.base32.as_bytes(),
            )?);
            row.totp_algorithm = Some(setup.algorithm);
            row.totp_digits = Some(setup.digits);
            row.totp_period = Some(setup.period);
        }
    }
    match &input.recovery_instructions {
        SecretUpdate::Unchanged => {}
        SecretUpdate::Clear => row.recovery_instructions_enc = None,
        SecretUpdate::Set { value } => {
            row.recovery_instructions_enc = match v::optional_multiline(
                Some(value),
                "recoveryInstructions",
                MAX_NOTES_CHARS,
            )? {
                None => None,
                Some(text) => {
                    let text = Zeroizing::new(text);
                    Some(seal(keys, TABLE, RECOVERY_COL, &row.id, text.as_bytes())?)
                }
            };
        }
    }

    repo::save(&tx, &row)?;
    account_repo::touch(&tx, account_id, &now)?;
    tx.commit()?;
    tracing::info!(account = %account_id, mfa = %row.id, "mfa method saved");
    accounts::detail(vault.conn(), vault.keys(), account_id)
}

pub fn delete(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let conn = vault.conn_mut();
    let tx = conn.transaction()?;
    let row = get(&tx, id)?;
    repo::delete(&tx, id)?;
    account_repo::touch(&tx, &row.account_id, &now)?;
    tx.commit()?;
    tracing::info!(account = %row.account_id, mfa = %id, "mfa method deleted");
    accounts::detail(vault.conn(), vault.keys(), &row.account_id)
}

/// Replaces the backup codes with those parsed from `text` (pasted as the
/// service showed them), or removes them with `None`. All start unused.
pub fn set_backup_codes(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    text: Option<&str>,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let codes = text.map(parse_backup_codes).transpose()?;
    let (conn, keys) = vault.conn_and_keys();
    let tx = conn.transaction()?;
    let mut row = get(&tx, id)?;
    match codes {
        Some(codes) => {
            row.backup_codes_enc = Some(seal_codes(keys, id, &codes)?);
            row.backup_codes_remaining = remaining(&codes);
            row.backup_codes_updated_at = Some(now.clone());
        }
        None => {
            row.backup_codes_enc = None;
            row.backup_codes_remaining = 0;
            row.backup_codes_updated_at = None;
        }
    }
    row.updated_at.clone_from(&now);
    repo::save(&tx, &row)?;
    account_repo::touch(&tx, &row.account_id, &now)?;
    tx.commit()?;
    tracing::info!(mfa = %id, count = row.backup_codes_remaining, "backup codes replaced");
    accounts::detail(vault.conn(), vault.keys(), &row.account_id)
}

/// Marks one backup code used (or not, to undo a mistake).
pub fn mark_code_used(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    index: u32,
    used: bool,
) -> Result<AccountDetail, AppError> {
    let now = clock.now_rfc3339();
    let (conn, keys) = vault.conn_and_keys();
    let tx = conn.transaction()?;
    let mut row = get(&tx, id)?;
    let mut codes = decrypt_codes(keys, &row)?;
    let code = usize::try_from(index)
        .ok()
        .and_then(|i| codes.get_mut(i))
        .ok_or(AppError::NotFound)?;
    code.used = used;
    row.backup_codes_enc = Some(seal_codes(keys, id, &codes)?);
    row.backup_codes_remaining = remaining(&codes);
    row.updated_at.clone_from(&now);
    repo::save(&tx, &row)?;
    account_repo::touch(&tx, &row.account_id, &now)?;
    tx.commit()?;
    tracing::info!(mfa = %id, remaining = row.backup_codes_remaining, "backup code marked");
    accounts::detail(vault.conn(), vault.keys(), &row.account_id)
}
