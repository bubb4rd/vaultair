//! Settings commands: the open vault's lock and clipboard settings and its
//! name and colour, changing the master password, strengthening the KDF, and
//! the logs folder. Capture protection and email masking are app config
//! (`commands::session`), because they apply while locked.

use serde::Serialize;
use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::crypto::kdf::{self, KdfParams};
use vaultair_core::service::session::SessionConfig;
use vaultair_core::service::settings::{self, VaultProfileInput, VaultSettings};
use vaultair_core::vault::{VaultError, VaultInfo};
use vaultair_core::AppError;

use super::vault::blocking;
use super::with_vault;
use crate::state::{dev_overrides, ipc_err, AppState, IpcResult};

/// Applies the open vault's saved settings to the session. Called after
/// every unlock and create, so a vault never runs with the last one's.
pub(super) async fn apply_saved(state: &AppState) {
    let loaded = with_vault(state, |v| settings::load(v.conn())).await;
    let saved = loaded.unwrap_or_else(|_| {
        tracing::warn!("could not read vault settings; using the defaults");
        VaultSettings::default()
    });
    state.locker.update_config(|c| {
        saved.apply_to(c);
        *c = dev_overrides(*c);
    });
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(state: State<'_, AppState>) -> IpcResult<VaultSettings> {
    with_vault(&state, |v| settings::load(v.conn())).await
}

/// Saves the settings and applies them now: the idle deadline, the lock
/// policy and the clipboard and reveal timings change without a restart.
///
/// With quick unlock on, turning auto-lock off takes the master password
/// (ADR-0005 decision 4): a vault that never locks and opens with Hello
/// would otherwise never ask for it. Without one: `quick_unlock_password_required`.
#[tauri::command]
#[specta::specta]
pub async fn settings_update(
    state: State<'_, AppState>,
    settings: VaultSettings,
    password: Option<String>,
) -> IpcResult<SessionConfig> {
    let password = password.map(secrecy::SecretString::from);
    let turning_auto_lock_off =
        settings.auto_lock_minutes.is_none() && state.locker.config().idle_lock_secs.is_some();
    if turning_auto_lock_off {
        let (quick, session) = (state.quick.clone(), state.session.clone());
        blocking(move || {
            if !quick.enabled_for_open_vault(&session) {
                return Ok(Ok(()));
            }
            match &password {
                Some(password) => session.verify_password(password).map(Ok),
                None => Ok(Err(AppError::QuickUnlockPasswordRequired)),
            }
        })
        .await?
        .map_err(ipc_err)?;
    }
    let saved = with_vault(&state, move |v| settings::save(v, &settings, &SystemClock)).await?;
    Ok(state.locker.update_config(|c| saved.apply_to(c)))
}

#[tauri::command]
#[specta::specta]
pub async fn vault_profile_update(
    state: State<'_, AppState>,
    input: VaultProfileInput,
) -> IpcResult<VaultInfo> {
    with_vault(&state, move |v| {
        settings::update_profile(v, &input, &SystemClock)
    })
    .await
}

/// Changes the master password. The vault stays unlocked. Backups made
/// before this still open with the old password.
#[tauri::command]
#[specta::specta]
pub async fn vault_change_password(
    state: State<'_, AppState>,
    current: String,
    new_password: String,
) -> IpcResult<VaultInfo> {
    let current = secrecy::SecretString::from(current);
    let new = secrecy::SecretString::from(new_password);
    let session = state.session.clone();
    let quick = state.quick.clone();
    let info = blocking(move || {
        let info = session.rewrap(&current, Some(&new), None)?;
        // The quick-unlock slot is bound to the old header. Remove it.
        quick.invalidate(&info.vault_id);
        Ok(info)
    })
    .await?;
    tracing::info!("master password changed");
    Ok(info)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KdfCheck {
    pub current: KdfParams,
    pub current_summary: String,
    /// What this PC can unlock in about a second.
    pub suggested: KdfParams,
    pub suggested_summary: String,
    /// `suggested` is stronger than `current`.
    pub can_strengthen: bool,
}

fn stronger(next: KdfParams, current: KdfParams) -> bool {
    next.m_kib > current.m_kib || next.t > current.t
}

fn weaker(next: KdfParams, current: KdfParams) -> bool {
    next.m_kib < current.m_kib || next.t < current.t
}

/// Measures this PC (about a second) and compares with the vault's KDF.
#[tauri::command]
#[specta::specta]
pub async fn vault_kdf_check(state: State<'_, AppState>) -> IpcResult<KdfCheck> {
    let session = state.session.clone();
    blocking(move || {
        let current = session.kdf_params()?;
        let suggested = kdf::calibrate(kdf::CALIBRATE_TARGET)?;
        Ok(KdfCheck {
            current,
            current_summary: current.summary(),
            suggested,
            suggested_summary: suggested.summary(),
            can_strengthen: stronger(suggested, current),
        })
    })
    .await
}

/// Re-wraps the vault key with `kdf` (from `vault_kdf_check`), keeping the
/// master password. Never lowers the memory or iteration count.
#[tauri::command]
#[specta::specta]
pub async fn vault_strengthen_kdf(
    state: State<'_, AppState>,
    password: String,
    kdf: KdfParams,
) -> IpcResult<VaultInfo> {
    let password = secrecy::SecretString::from(password);
    let session = state.session.clone();
    let current = session.kdf_params().map_err(ipc_err)?;
    if weaker(kdf, current) {
        return Err(ipc_err(AppError::InvalidInput { field: "kdf" }));
    }
    let quick = state.quick.clone();
    blocking(move || {
        let info = session.rewrap(&password, None, Some(kdf))?;
        // A new KDF is a new header too, so the quick-unlock slot is void.
        quick.invalidate(&info.vault_id);
        Ok(info)
    })
    .await
}

/// Where the diagnostic logs are. `None` without `LOCALAPPDATA`.
#[tauri::command]
#[specta::specta]
pub fn logs_folder() -> Option<String> {
    crate::logging::log_dir().map(|d| d.display().to_string())
}

/// Opens the logs folder in File Explorer.
#[tauri::command]
#[specta::specta]
pub async fn logs_open() -> IpcResult<()> {
    let Some(dir) = crate::logging::log_dir() else {
        return Err(ipc_err(AppError::NotFound));
    };
    blocking(move || open_folder(&dir)).await
}

#[cfg(windows)]
fn open_folder(dir: &std::path::Path) -> Result<(), VaultError> {
    vaultair_platform::windows::open_folder(dir).map_err(|e| {
        tracing::warn!(error = %e, "could not open the logs folder");
        VaultError::Io(std::io::ErrorKind::Other)
    })
}

#[cfg(not(windows))]
fn open_folder(_dir: &std::path::Path) -> Result<(), VaultError> {
    Err(VaultError::Io(std::io::ErrorKind::Unsupported))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strengthening_never_lowers_the_kdf() {
        let base = KdfParams::MINIMUM;
        let more_memory = KdfParams {
            m_kib: base.m_kib * 2,
            ..base
        };
        assert!(stronger(more_memory, base) && !weaker(more_memory, base));
        assert!(!stronger(base, base) && !weaker(base, base));
        assert!(weaker(base, more_memory));
        // More memory but fewer passes is still a downgrade.
        let fewer_passes = KdfParams {
            m_kib: base.m_kib * 2,
            t: base.t - 1,
            ..base
        };
        assert!(weaker(fewer_passes, base));
    }
}
