//! MFA methods. Several per account; their secrets (TOTP key, backup codes,
//! recovery instructions) are field envelopes.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::mfa::{MfaMethod, TotpAlgorithm};

/// An MFA method as stored.
#[derive(Clone, PartialEq, Eq)]
pub struct MfaRow {
    pub id: String,
    pub account_id: String,
    pub method: MfaMethod,
    pub enabled: bool,
    pub totp_secret_enc: Option<Vec<u8>>,
    pub totp_algorithm: Option<TotpAlgorithm>,
    pub totp_digits: Option<u8>,
    pub totp_period: Option<u32>,
    pub backup_codes_enc: Option<Vec<u8>>,
    pub backup_codes_remaining: u32,
    pub backup_codes_updated_at: Option<String>,
    pub recovery_instructions_enc: Option<Vec<u8>>,
    pub notes: Option<String>,
    pub updated_at: String,
}

impl std::fmt::Debug for MfaRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MfaRow")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("enabled", &self.enabled)
            .finish_non_exhaustive()
    }
}

const SELECT: &str = "SELECT id, account_id, method, enabled, totp_secret_enc, totp_algorithm,
    totp_digits, totp_period, backup_codes_enc, backup_codes_remaining, backup_codes_updated_at,
    recovery_instructions_enc, notes, updated_at FROM mfa_method";

fn row(r: &Row<'_>) -> rusqlite::Result<MfaRow> {
    Ok(MfaRow {
        id: r.get(0)?,
        account_id: r.get(1)?,
        method: r.get(2)?,
        enabled: r.get(3)?,
        totp_secret_enc: r.get(4)?,
        totp_algorithm: r.get(5)?,
        totp_digits: r.get(6)?,
        totp_period: r.get(7)?,
        backup_codes_enc: r.get(8)?,
        backup_codes_remaining: u32::try_from(r.get::<_, i64>(9)?.max(0)).unwrap_or(0),
        backup_codes_updated_at: r.get(10)?,
        recovery_instructions_enc: r.get(11)?,
        notes: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

/// An account's methods, oldest first.
pub fn for_account(conn: &Connection, account_id: &str) -> rusqlite::Result<Vec<MfaRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE account_id = ?1 ORDER BY created_at, id"
    ))?;
    let rows = stmt.query_map([account_id], row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<MfaRow>> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()
}

/// Inserts or updates the whole row. `created_at` is set on insert only.
pub fn save(conn: &Connection, m: &MfaRow) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO mfa_method (id, account_id, method, enabled, totp_secret_enc, totp_algorithm,
            totp_digits, totp_period, backup_codes_enc, backup_codes_remaining,
            backup_codes_updated_at, recovery_instructions_enc, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT(id) DO UPDATE SET method = excluded.method, enabled = excluded.enabled,
            totp_secret_enc = excluded.totp_secret_enc, totp_algorithm = excluded.totp_algorithm,
            totp_digits = excluded.totp_digits, totp_period = excluded.totp_period,
            backup_codes_enc = excluded.backup_codes_enc,
            backup_codes_remaining = excluded.backup_codes_remaining,
            backup_codes_updated_at = excluded.backup_codes_updated_at,
            recovery_instructions_enc = excluded.recovery_instructions_enc,
            notes = excluded.notes, updated_at = excluded.updated_at",
        params![
            m.id,
            m.account_id,
            m.method,
            m.enabled,
            m.totp_secret_enc,
            m.totp_algorithm,
            m.totp_digits,
            m.totp_period,
            m.backup_codes_enc,
            m.backup_codes_remaining,
            m.backup_codes_updated_at,
            m.recovery_instructions_enc,
            m.notes,
            m.updated_at
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute("DELETE FROM mfa_method WHERE id = ?1", [id])? == 1)
}
