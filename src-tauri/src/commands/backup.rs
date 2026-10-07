//! Encrypted backups (Phase 14). Thin: each command runs the matching
//! `vaultair_core` call. Making and checking a backup need the unlocked
//! vault; restoring doesn't, because a restore is what's left when a vault
//! won't open.
//!
//! Paths arrive from the webview as strings (Rust's own pickers return them)
//! and are validated again here and in the core.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use vaultair_core::backup::{restore_backup, RestoreOptions, EXTENSION};
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::config::default_app_dir;
use vaultair_core::service::backup::{self as service, BackupStatus, BackupSummary};
use vaultair_core::vault::VaultError;
use vaultair_core::AppError;

use super::vault::{absolute_dir, blocking, owner_handle, parent_or_default};
use super::with_vault;
use crate::state::{ipc_err, AppState, IpcResult};

/// Where a backup's database is copied (still encrypted) to be opened and
/// checked. Emptied again after each check. See docs/local-data-storage.md.
fn scratch_dir() -> PathBuf {
    default_app_dir().map_or_else(std::env::temp_dir, |dir| dir.join("tmp"))
}

fn absolute_file(path: &str) -> Result<PathBuf, AppError> {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        Ok(p)
    } else {
        Err(AppError::InvalidInput { field: "path" })
    }
}

/// Where backups go, how the last one went, and whether one is due.
#[tauri::command]
#[specta::specta]
pub async fn backup_status(state: State<'_, AppState>) -> IpcResult<BackupStatus> {
    let roots = state.cloud_roots.clone();
    with_vault(&state, move |v| {
        service::status(v, &roots, SystemClock.now_utc())
    })
    .await
}

/// Sets the folder backups are written to; `null` clears it. The folder must
/// exist and be outside the vault's own folder.
#[tauri::command]
#[specta::specta]
pub async fn backup_set_destination(
    state: State<'_, AppState>,
    path: Option<String>,
) -> IpcResult<BackupStatus> {
    let roots = state.cloud_roots.clone();
    with_vault(&state, move |v| {
        service::set_destination(v, path.as_deref().map(Path::new), &SystemClock)?;
        service::status(v, &roots, SystemClock.now_utc())
    })
    .await
}

/// Writes a backup to the destination folder and reads it back before
/// reporting success.
#[tauri::command]
#[specta::specta]
pub async fn backup_create(state: State<'_, AppState>) -> IpcResult<BackupSummary> {
    with_vault(&state, |v| service::create(v, &scratch_dir(), &SystemClock)).await
}

/// Checks a backup of the open vault: the MAC over the whole file, then
/// every database page.
#[tauri::command]
#[specta::specta]
pub async fn backup_verify(state: State<'_, AppState>, path: String) -> IpcResult<BackupSummary> {
    let path = absolute_file(&path).map_err(ipc_err)?;
    with_vault(&state, move |v| service::verify(v, &path, &scratch_dir())).await
}

/// Shows the system file picker for a backup. Returns `None` if cancelled,
/// and `invalid_backup` for a file that isn't one. The date and size come
/// from the file itself and aren't checked until it's verified or restored.
#[tauri::command]
#[specta::specta]
pub async fn backup_pick_file(window: WebviewWindow) -> IpcResult<Option<BackupSummary>> {
    let owner = owner_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = pick_file(owner)? else {
            return Ok(None);
        };
        service::inspect(&path).map(Some)
    })
    .await
    .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
    .map_err(ipc_err)
}

#[cfg(windows)]
fn pick_file(owner: isize) -> Result<Option<PathBuf>, AppError> {
    let pattern = format!("*.{EXTENSION}");
    vaultair_platform::windows::pick_file(
        owner,
        "Choose a backup",
        None,
        ("Vaultair backups", &pattern),
    )
    .map_err(|e| {
        tracing::warn!(error = %e, "file picker failed");
        AppError::Internal {
            context: "file picker",
        }
    })
}

#[cfg(not(windows))]
fn pick_file(_owner: isize) -> Result<Option<PathBuf>, AppError> {
    let _ = EXTENSION;
    Err(AppError::Internal {
        context: "file picker",
    })
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupRequest {
    pub backup_path: String,
    /// Parent folder for the restored vault. Defaults to
    /// `%LOCALAPPDATA%\Vaultair\Vaults`.
    pub location: Option<String>,
    /// The restored vault's name, also its folder name.
    pub name: String,
    /// The master password the vault had when the backup was made.
    pub password: String,
}

/// Written out so the master password can never be formatted into a log line
/// or a panic message. The paths and the name stay out too.
impl std::fmt::Debug for RestoreBackupRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RestoreBackupRequest")
            .field("password", &"[redacted]")
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoredVault {
    /// The new vault folder. It is added to the recent vaults.
    pub path: String,
}

/// Restores a backup into a new vault folder. Works with or without an open
/// vault and never changes one: the restored vault is opened like any other,
/// from the lock screen.
#[tauri::command]
#[specta::specta]
pub async fn backup_restore_to(
    state: State<'_, AppState>,
    request: RestoreBackupRequest,
) -> IpcResult<RestoredVault> {
    let RestoreBackupRequest {
        backup_path,
        location,
        name,
        password,
    } = request;
    let password = secrecy::SecretString::from(password);
    let backup = absolute_dir(&backup_path)
        .map_err(|_| VaultError::InvalidBackup)
        .map_err(ipc_err)?;
    let parent_dir = parent_or_default(location).map_err(ipc_err)?;
    let dir = blocking(move || {
        restore_backup(
            &RestoreOptions {
                backup,
                parent_dir,
                name,
            },
            &password,
            &SystemClock,
        )
    })
    .await?;
    let path = dir.display().to_string();
    state
        .config
        .record_recent(&path, &SystemClock.now_rfc3339());
    Ok(RestoredVault { path })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    /// The request as the webview sends it. Nothing that formats it (a log
    /// line, a panic message) may show the master password or the paths.
    #[test]
    fn restore_request_never_prints_the_master_password() {
        let request: RestoreBackupRequest = serde_json::from_str(
            r#"{"backupPath":"D:/Backups/CANARYUSER-20261005-070809.vaultair-backup",
                "location":null,"name":"CANARYUSER restored",
                "password":"CANARY7F3A master password"}"#,
        )
        .unwrap();
        let debug = format!("{request:?} {request:#?}");
        assert!(!debug.contains("CANARY"), "{debug}");
        assert!(debug.contains("[redacted]"));
    }
}
