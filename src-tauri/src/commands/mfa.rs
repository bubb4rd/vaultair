//! MFA commands (Phase 7). Each write returns the account's updated detail
//! so the page can redraw in one step.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::account::{AccountDetail, TotpCodeView};
use vaultair_core::domain::mfa::MfaInput;
use vaultair_core::service::mfa;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// Adds an MFA method to an account, or edits one (`input.id`).
#[tauri::command]
#[specta::specta]
pub async fn mfa_upsert(
    state: State<'_, AppState>,
    account_id: String,
    input: MfaInput,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        mfa::upsert(v, &SystemClock, &account_id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn mfa_delete(state: State<'_, AppState>, id: String) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| mfa::delete(v, &SystemClock, &id)).await
}

/// Replaces the backup codes with those pasted in `codes`, or removes them
/// (`None`). Parsed and encrypted in Rust; the list is never sent back.
#[tauri::command]
#[specta::specta]
pub async fn mfa_set_backup_codes(
    state: State<'_, AppState>,
    id: String,
    codes: Option<String>,
) -> IpcResult<AccountDetail> {
    let codes = codes.map(zeroize::Zeroizing::new);
    with_vault(&state, move |v| {
        mfa::set_backup_codes(v, &SystemClock, &id, codes.as_deref().map(String::as_str))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn mfa_mark_code_used(
    state: State<'_, AppState>,
    id: String,
    index: u32,
    used: bool,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        mfa::mark_code_used(v, &SystemClock, &id, index, used)
    })
    .await
}

/// The current TOTP code and seconds until it changes, for display.
#[tauri::command]
#[specta::specta]
pub async fn totp_current_code(state: State<'_, AppState>, id: String) -> IpcResult<TotpCodeView> {
    with_vault(&state, move |v| mfa::totp_code(v, &SystemClock, &id)).await
}
