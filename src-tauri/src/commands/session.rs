//! Session commands: activity pings for the idle lock, the lock and clipboard
//! settings, and screen-capture protection.

use tauri::State;
use vaultair_core::service::session::SessionConfig;

use crate::lock::LockNotice;
use crate::state::{apply_capture_protection, AppState};

/// Records user activity, pushing the idle-lock deadline back. The UI calls
/// it at most every 15 s while the pointer or keyboard is in use. Returns
/// false if the vault is locked.
#[tauri::command]
#[specta::specta]
pub fn session_touch(state: State<'_, AppState>) -> bool {
    state.session.touch()
}

/// Current lock, clipboard and capture settings.
#[tauri::command]
#[specta::specta]
pub fn session_config_get(state: State<'_, AppState>) -> SessionConfig {
    state.locker.config()
}

/// Turns screen-capture protection on or off, now and on future launches
/// (the lock screen included). Returns the updated settings.
#[tauri::command]
#[specta::specta]
pub fn capture_protection_set(state: State<'_, AppState>, enabled: bool) -> SessionConfig {
    state.config.set_capture_protection(enabled);
    apply_capture_protection(state.capture.as_ref(), enabled);
    tracing::info!(enabled, "capture protection changed");
    state
        .locker
        .update_config(|c| c.capture_protection = enabled)
}

/// Why the vault last locked (button or Ctrl+L, idle, Windows lock, sleep),
/// so the lock screen can say so. Returns it once, then `None`.
#[tauri::command]
#[specta::specta]
pub fn session_take_lock_notice(state: State<'_, AppState>) -> Option<LockNotice> {
    state.locker.take_notice()
}
