//! Vault lifecycle commands (Phase 3: wired, no UI yet).
//!
//! Passwords arrive from the webview as JSON strings and are moved straight
//! into `SecretString` (wiped on drop). Copies made by IPC deserialization
//! and in the JS heap can't be wiped; see docs/security-assumptions.md.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;
use vaultair_core::crypto::kdf::{self, KdfParams};
use vaultair_core::service::session::VaultStatus;
use vaultair_core::vault::layout::default_vaults_dir;
use vaultair_core::vault::{CreateOptions, IntegrityReport, VaultError, VaultInfo};
use vaultair_core::AppError;

use crate::state::{ipc_err, AppState, IpcResult};

/// Runs slow work (Argon2, SQLCipher) off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, VaultError> + Send + 'static,
) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(ipc_err)
}

/// Measures this device and suggests Argon2id parameters (~0.85 s unlock).
#[tauri::command]
#[specta::specta]
pub async fn vault_kdf_calibrate() -> IpcResult<KdfParams> {
    blocking(|| kdf::calibrate(kdf::CALIBRATE_TARGET).map_err(VaultError::from)).await
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    pub name: String,
    /// Parent folder. Defaults to `%LOCALAPPDATA%\Vaultair\Vaults`.
    pub location: Option<String>,
    pub kdf: KdfParams,
    pub password: String,
}

#[tauri::command]
#[specta::specta]
pub async fn vault_create(
    state: State<'_, AppState>,
    request: CreateVaultRequest,
) -> IpcResult<VaultInfo> {
    let CreateVaultRequest {
        name,
        location,
        kdf,
        password,
    } = request;
    let password = secrecy::SecretString::from(password);
    let parent_dir = match location {
        Some(l) => PathBuf::from(l),
        None => default_vaults_dir().ok_or_else(|| ipc_err(VaultError::InvalidLocation))?,
    };
    let session = state.session.clone();
    blocking(move || {
        session.create(
            &CreateOptions {
                parent_dir,
                name,
                kdf,
                demo: false,
            },
            &password,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_unlock(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> IpcResult<VaultInfo> {
    let password = secrecy::SecretString::from(password);
    let session = state.session.clone();
    blocking(move || session.unlock(&PathBuf::from(path), &password)).await
}

/// Returns whether a vault was open.
#[tauri::command]
#[specta::specta]
pub fn vault_lock(state: State<'_, AppState>) -> bool {
    state.session.lock()
}

#[tauri::command]
#[specta::specta]
pub fn vault_status(state: State<'_, AppState>) -> VaultStatus {
    state.session.status()
}

#[tauri::command]
#[specta::specta]
pub async fn vault_integrity_check(state: State<'_, AppState>) -> IpcResult<IntegrityReport> {
    let session = state.session.clone();
    blocking(move || session.integrity_check()).await
}
