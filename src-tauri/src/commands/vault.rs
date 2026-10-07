//! Vault lifecycle commands: create, unlock, lock, status, and the pre-unlock
//! helpers onboarding and the lock screen need (location check, folder picker).
//!
//! Passwords arrive from the webview as JSON strings and are moved straight
//! into `SecretString` (wiped on drop). Copies made by IPC deserialization
//! and in the JS heap can't be wiped; see docs/security-assumptions.md.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::crypto::kdf::{self, KdfParams};
use vaultair_core::service::session::VaultStatus;
use vaultair_core::vault::layout::{default_vaults_dir, validate_name, HEADER_FILE};
use vaultair_core::vault::location::CloudProvider;
use vaultair_core::vault::{CreateOptions, IntegrityReport, VaultError, VaultInfo};
use vaultair_core::AppError;

use crate::lock::LockReason;
use crate::state::{ipc_err, AppState, IpcResult};

/// Runs slow work (Argon2, SQLCipher, modal dialogs) off the async runtime's
/// worker threads.
pub(super) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, VaultError> + Send + 'static,
) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(ipc_err)
}

/// A folder path from the webview: must be absolute. Rust re-validates every
/// path it's handed, including ones its own folder picker returned.
pub(super) fn absolute_dir(path: &str) -> Result<PathBuf, VaultError> {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        Ok(p)
    } else {
        Err(VaultError::InvalidLocation)
    }
}

pub(super) fn parent_or_default(location: Option<String>) -> Result<PathBuf, VaultError> {
    match location {
        Some(l) => absolute_dir(&l),
        None => default_vaults_dir().ok_or(VaultError::InvalidLocation),
    }
}

pub(super) fn record_recent(state: &AppState, info: &VaultInfo) {
    state
        .config
        .record_recent(&info.path, &SystemClock.now_rfc3339());
}

/// Measures this device and suggests Argon2id parameters (~0.85 s unlock).
#[tauri::command]
#[specta::specta]
pub async fn vault_kdf_calibrate() -> IpcResult<KdfParams> {
    blocking(|| kdf::calibrate(kdf::CALIBRATE_TARGET).map_err(VaultError::from)).await
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    pub name: String,
    /// Parent folder. Defaults to `%LOCALAPPDATA%\Vaultair\Vaults`.
    pub location: Option<String>,
    pub kdf: KdfParams,
    pub password: String,
}

/// Written out so the master password can never be formatted into a log line
/// or a panic message. The name and location stay out too: they are a path.
impl std::fmt::Debug for CreateVaultRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreateVaultRequest")
            .field("kdf", &self.kdf)
            .field("password", &"[redacted]")
            .finish_non_exhaustive()
    }
}

async fn create(state: &AppState, request: CreateVaultRequest, demo: bool) -> IpcResult<VaultInfo> {
    let CreateVaultRequest {
        name,
        location,
        kdf,
        password,
    } = request;
    let password = secrecy::SecretString::from(password);
    let parent_dir = parent_or_default(location).map_err(ipc_err)?;
    let session = state.session.clone();
    let info = blocking(move || {
        session.create(
            &CreateOptions {
                parent_dir,
                name,
                kdf,
                demo,
            },
            &password,
        )
    })
    .await?;
    record_recent(state, &info);
    super::settings::apply_saved(state).await;
    tracing::info!(demo, "vault created");
    if demo {
        // The vault exists either way; if seeding fails it's simply emptier.
        let seeded = super::with_vault(state, |v| vaultair_core::demo::seed(v, &SystemClock)).await;
        if seeded.is_err() {
            tracing::warn!("demo vault created without sample data");
        }
    }
    Ok(info)
}

#[tauri::command]
#[specta::specta]
pub async fn vault_create(
    state: State<'_, AppState>,
    request: CreateVaultRequest,
) -> IpcResult<VaultInfo> {
    create(&state, request, false).await
}

/// Same as `vault_create`, but the vault is flagged as a demo and filled with
/// sample accounts (`vaultair_core::demo`). It's a real encrypted vault with
/// its own password.
#[tauri::command]
#[specta::specta]
pub async fn vault_create_demo(
    state: State<'_, AppState>,
    request: CreateVaultRequest,
) -> IpcResult<VaultInfo> {
    create(&state, request, true).await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_unlock(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> IpcResult<VaultInfo> {
    let password = secrecy::SecretString::from(password);
    let dir = absolute_dir(&path).map_err(ipc_err)?;
    let session = state.session.clone();
    let quick = state.quick.clone();
    let info = blocking(move || {
        let info = session.unlock(&dir, &password)?;
        // Typing the password restarts quick unlock's 7 days.
        quick.record_password_unlock(&session);
        Ok(info)
    })
    .await?;
    record_recent(&state, &info);
    super::settings::apply_saved(&state).await;
    Ok(info)
}

/// Locks, clears our clipboard value and emits `vault://locked`. Returns
/// whether a vault was open. Async so a busy clipboard never stalls the UI thread.
#[tauri::command]
#[specta::specta]
pub async fn vault_lock(state: State<'_, AppState>) -> IpcResult<bool> {
    let locker = state.locker.clone();
    tauri::async_runtime::spawn_blocking(move || locker.lock(LockReason::Manual))
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))
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

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocationCheck {
    /// The folder the vault folder will be created in.
    pub parent_dir: String,
    /// Where the vault itself will live: `parent_dir\<name>`.
    pub vault_dir: String,
    /// Set when the folder looks synced to a cloud service (warn, don't block).
    pub cloud_provider: Option<CloudProvider>,
    /// A non-empty folder with this name already exists (create would fail).
    pub already_exists: bool,
}

/// Where a new vault named `name` would go, and whether that's a good idea.
/// `location` `None` means the default folder.
#[tauri::command]
#[specta::specta]
pub fn vault_location_check(
    state: State<'_, AppState>,
    location: Option<String>,
    name: String,
) -> IpcResult<LocationCheck> {
    if !validate_name(&name) {
        return Err(ipc_err(VaultError::InvalidName));
    }
    let parent = parent_or_default(location).map_err(ipc_err)?;
    let vault_dir = parent.join(&name);
    let already_exists = std::fs::read_dir(&vault_dir).is_ok_and(|mut d| d.next().is_some());
    Ok(LocationCheck {
        cloud_provider: state.cloud_roots.classify(&vault_dir),
        parent_dir: parent.display().to_string(),
        vault_dir: vault_dir.display().to_string(),
        already_exists,
    })
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FolderPurpose {
    /// Choose where a new vault's folder goes.
    NewVaultLocation,
    /// Choose an existing vault's folder (the one containing `vault.vhdr`).
    ExistingVault,
    /// Choose the folder backups are written to.
    BackupDestination,
    /// Choose where a restored vault's folder goes.
    RestoreLocation,
}

/// Shows the system folder picker. Returns `None` if cancelled. For
/// `ExistingVault`, a folder without a vault header is `vault_not_found`.
#[tauri::command]
#[specta::specta]
pub async fn vault_pick_folder(
    window: WebviewWindow,
    purpose: FolderPurpose,
) -> IpcResult<Option<String>> {
    let owner = owner_handle(&window);
    // Backups belong somewhere other than beside the vaults.
    let initial = match purpose {
        FolderPurpose::BackupDestination => None,
        _ => default_vaults_dir(),
    };
    blocking(move || {
        let title = match purpose {
            FolderPurpose::NewVaultLocation => "Choose where to keep your vault",
            FolderPurpose::ExistingVault => "Choose a vault folder",
            FolderPurpose::BackupDestination => "Choose where to keep backups",
            FolderPurpose::RestoreLocation => "Choose where to put the restored vault",
        };
        let Some(dir) = pick_folder(owner, title, initial.as_deref())? else {
            return Ok(None);
        };
        if matches!(purpose, FolderPurpose::ExistingVault) && !dir.join(HEADER_FILE).is_file() {
            return Err(VaultError::NotFound);
        }
        Ok(Some(dir.display().to_string()))
    })
    .await
}

#[cfg(windows)]
pub(super) fn owner_handle(window: &WebviewWindow) -> isize {
    window.hwnd().map_or(0, |h| h.0 as isize)
}

#[cfg(not(windows))]
pub(super) fn owner_handle(_window: &WebviewWindow) -> isize {
    0
}

#[cfg(windows)]
fn pick_folder(
    owner: isize,
    title: &str,
    initial: Option<&Path>,
) -> Result<Option<PathBuf>, VaultError> {
    vaultair_platform::windows::pick_folder(owner, title, initial).map_err(|e| {
        tracing::warn!(error = %e, "folder picker failed");
        VaultError::Io(std::io::ErrorKind::Other)
    })
}

#[cfg(not(windows))]
fn pick_folder(
    _owner: isize,
    _title: &str,
    _initial: Option<&Path>,
) -> Result<Option<PathBuf>, VaultError> {
    Err(VaultError::Io(std::io::ErrorKind::Unsupported))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    /// The request as the webview sends it. Nothing that formats it (a log
    /// line, a panic message) may show the master password or where the
    /// vault goes.
    #[test]
    fn create_request_never_prints_the_master_password() {
        let request: CreateVaultRequest = serde_json::from_str(
            r#"{"name":"CANARYUSER vault","location":"C:/Users/CANARYUSER/Vaults",
                "kdf":{"mKib":65536,"t":3,"p":4},"password":"CANARY7F3A master password"}"#,
        )
        .unwrap();
        let debug = format!("{request:?} {request:#?}");
        assert!(!debug.contains("CANARY"), "{debug}");
        assert!(debug.contains("[redacted]") && debug.contains("65536"));
    }
}
