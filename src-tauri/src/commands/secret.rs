//! The two ways a stored secret leaves the vault.
//!
//! - `clipboard_copy_secret`: Rust decrypts and writes straight to the
//!   clipboard (kept out of history, cleared automatically). The value never
//!   crosses into the webview.
//! - `secret_reveal`: returns one value for display, because showing it needs
//!   it. The UI keeps it in component state and hides it again after
//!   `reveal_hide_secs`; a lock reloads the webview.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::account::{RevealedSecret, SecretRef};
use vaultair_core::service::accounts;
use vaultair_core::AppError;

use super::clipboard::{platform_err, ClipboardCopy};
use super::with_vault;
use crate::state::{ipc_err, AppState, IpcResult};

#[tauri::command]
#[specta::specta]
pub async fn secret_reveal(
    state: State<'_, AppState>,
    target: SecretRef,
) -> IpcResult<RevealedSecret> {
    let value = with_vault(&state, move |v| accounts::reveal(v, &SystemClock, &target)).await?;
    Ok(RevealedSecret {
        value: value.as_str().to_owned(),
    })
}

/// Copies a stored secret (password, TOTP code, backup code, …) without it
/// ever reaching the webview.
#[tauri::command]
#[specta::specta]
pub async fn clipboard_copy_secret(
    state: State<'_, AppState>,
    target: SecretRef,
) -> IpcResult<ClipboardCopy> {
    let value = with_vault(&state, move |v| accounts::reveal(v, &SystemClock, &target)).await?;
    let config = state.locker.config();
    let clipboard = state.clipboard.clone();
    tauri::async_runtime::spawn_blocking(move || clipboard.copy(&value, config.clipboard_clear()))
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(|e| ipc_err(platform_err(e)))?;
    Ok(ClipboardCopy {
        clear_after_secs: config.clipboard_clear_secs,
    })
}
