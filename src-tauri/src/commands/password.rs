//! Master password strength, scored in Rust so the UI mirrors the enforced
//! policy exactly (ADR-0004 decision 4).

use vaultair_core::crypto::password::{self, StrengthEstimate};

/// Called (debounced) as the user types a new master password. The value is
/// scored and dropped; it is never stored or logged.
#[tauri::command]
#[specta::specta]
pub fn strength_estimate(password: String) -> StrengthEstimate {
    password::estimate(&secrecy::SecretString::from(password))
}
