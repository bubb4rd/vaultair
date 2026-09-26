//! SQL for each table group. Functions take a `&Connection` (a transaction
//! derefs to one) and return plain rows or view types; the services decide
//! what runs in which transaction and handle encryption.
//!
//! Secret columns (`*_enc`) are read and written only through `seal` and
//! `open` here, so every envelope is bound to its exact cell.

pub mod account;
pub mod catalog;
pub mod contact;
pub mod game_profile;
pub mod identity;
pub mod mfa;
pub mod purpose;
pub mod saved_view;
pub mod tag;

use zeroize::Zeroizing;

use crate::crypto::envelope::{self, FieldRef};
use crate::crypto::keys::VaultKeys;
use crate::AppError;

/// A new row id (UUIDv7: time-ordered, so ids sort by creation).
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Encrypts `plaintext` for `table.column` of row `row_id`.
pub fn seal(
    keys: &VaultKeys,
    table: &str,
    column: &str,
    row_id: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, AppError> {
    envelope::seal(
        keys.field_key(),
        FieldRef {
            table,
            column,
            row_id,
        },
        plaintext,
    )
    .map_err(|e| {
        tracing::error!(error = %e, table, column, "could not seal a field");
        AppError::Internal { context: "crypto" }
    })
}

/// Decrypts the envelope in `table.column` of row `row_id`. A failure means
/// the database was tampered with or damaged, never a user mistake.
pub fn open(
    keys: &VaultKeys,
    table: &str,
    column: &str,
    row_id: &str,
    blob: &[u8],
) -> Result<Zeroizing<Vec<u8>>, AppError> {
    envelope::open(
        keys.field_key(),
        FieldRef {
            table,
            column,
            row_id,
        },
        blob,
    )
    .map_err(|e| {
        tracing::error!(error = %e, table, column, "could not open a field envelope");
        AppError::VaultCorrupted
    })
}

/// Decrypts an envelope holding UTF-8 text.
pub fn open_text(
    keys: &VaultKeys,
    table: &str,
    column: &str,
    row_id: &str,
    blob: &[u8],
) -> Result<Zeroizing<String>, AppError> {
    let bytes = open(keys, table, column, row_id, blob)?;
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(Zeroizing::new(s.to_owned())),
        Err(_) => {
            tracing::error!(table, column, "field envelope is not UTF-8");
            Err(AppError::VaultCorrupted)
        }
    }
}
