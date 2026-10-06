//! Quick unlock commands (ADR-0005): whether Windows Hello can unlock a
//! vault right now, turning it on and off, and unlocking with it.
//!
//! Turning it on or off takes the master password. Every failure is a
//! static code; the UI falls back to the password field.

use tauri::State;
use vaultair_core::service::quick_unlock::{QuickUnlockError, QuickUnlockStatus};
use vaultair_core::vault::VaultInfo;
use vaultair_core::AppError;

use super::vault::{absolute_dir, record_recent};
use crate::state::{ipc_err, AppState, IpcResult};

/// Hello prompts, DPAPI and Argon2 all block, so they run off the async
/// runtime's worker threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, QuickUnlockError> + Send + 'static,
) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(ipc_err)
}

/// Whether the vault in `path` can be unlocked with Windows Hello now, and
/// if not, why the password is needed. Works while locked.
#[tauri::command]
#[specta::specta]
pub async fn quick_unlock_status(
    state: State<'_, AppState>,
    path: String,
) -> IpcResult<QuickUnlockStatus> {
    let dir = absolute_dir(&path).map_err(ipc_err)?;
    let quick = state.quick.clone();
    blocking(move || Ok(quick.status(&dir))).await
}

/// Turns quick unlock on for the open vault on this PC. Shows a Windows
/// Hello prompt.
#[tauri::command]
#[specta::specta]
pub async fn quick_unlock_enable(
    state: State<'_, AppState>,
    password: String,
) -> IpcResult<QuickUnlockStatus> {
    let password = secrecy::SecretString::from(password);
    let (quick, session) = (state.quick.clone(), state.session.clone());
    blocking(move || quick.enable(&session, &password)).await
}

/// Unlocks the vault in `path` with Windows Hello. Shows a Hello prompt.
#[tauri::command]
#[specta::specta]
pub async fn quick_unlock_unlock(state: State<'_, AppState>, path: String) -> IpcResult<VaultInfo> {
    let dir = absolute_dir(&path).map_err(ipc_err)?;
    let (quick, session) = (state.quick.clone(), state.session.clone());
    let info = blocking(move || quick.unlock(&session, &dir)).await?;
    record_recent(&state, &info);
    super::settings::apply_saved(&state).await;
    Ok(info)
}

/// Turns quick unlock off for the open vault on this PC: deletes the slot
/// and the Hello key.
#[tauri::command]
#[specta::specta]
pub async fn quick_unlock_forget(
    state: State<'_, AppState>,
    password: String,
) -> IpcResult<QuickUnlockStatus> {
    let password = secrecy::SecretString::from(password);
    let (quick, session) = (state.quick.clone(), state.session.clone());
    blocking(move || quick.forget(&session, &password)).await
}
