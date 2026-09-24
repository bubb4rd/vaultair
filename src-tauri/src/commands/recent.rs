//! The recent-vaults list shown on the lock screen. Paths only; see
//! `vaultair_core::config`.

use tauri::State;
use vaultair_core::config::RecentVault;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn recent_vaults_list(state: State<'_, AppState>) -> Vec<RecentVault> {
    state.config.recent_vaults()
}

/// Removes a vault from the list. The vault's files are not touched.
#[tauri::command]
#[specta::specta]
pub fn recent_vaults_forget(state: State<'_, AppState>, path: String) -> Vec<RecentVault> {
    state.config.forget_recent(&path);
    state.config.recent_vaults()
}
