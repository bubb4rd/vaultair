//! Session commands: activity pings for the idle lock, the lock and clipboard
//! settings, and screen-capture protection.

use tauri::State;
use vaultair_core::config::{applied_capture, CaptureLevel, CaptureMode};
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

/// Saves the capture policy and applies its steady state now: Always hides
/// the window, Off and Custom show it until an account qualifies.
#[tauri::command]
#[specta::specta]
pub fn capture_policy_set(
    state: State<'_, AppState>,
    mode: CaptureMode,
    level: CaptureLevel,
) -> SessionConfig {
    state.config.set_capture_policy(mode, level);
    let enabled = mode.hides_at_rest();
    apply_capture_protection(state.capture.as_ref(), enabled);
    tracing::info!(?mode, ?level, enabled, "capture policy changed");
    state.locker.update_config(|c| {
        c.capture_mode = mode;
        c.capture_level = level;
        c.capture_protection = enabled;
    })
}

/// Saves whether account emails stay masked until shown.
#[tauri::command]
#[specta::specta]
pub fn hide_emails_set(state: State<'_, AppState>, enabled: bool) -> SessionConfig {
    state.config.set_hide_emails(enabled);
    tracing::info!(enabled, "hide emails changed");
    state.locker.update_config(|c| c.hide_emails = enabled)
}

/// Saves whether closing the window keeps Vaultair in the tray, and shows
/// or removes the tray icon to match.
#[tauri::command]
#[specta::specta]
pub fn tray_set(app: tauri::AppHandle, state: State<'_, AppState>, enabled: bool) -> SessionConfig {
    state.config.set_keep_in_tray(enabled);
    crate::tray::set_visible(&app, enabled);
    tracing::info!(enabled, "keep in tray changed");
    state.locker.update_config(|c| c.keep_in_tray = enabled)
}

/// Hides or shows the window for the account on screen. Ignored unless the
/// saved mode is Custom, so navigation cannot override Always or Off.
#[tauri::command]
#[specta::specta]
pub fn capture_apply(state: State<'_, AppState>, enabled: bool) -> SessionConfig {
    let current = state.locker.config();
    let next = applied_capture(current.capture_mode, current.capture_protection, enabled);
    if next == current.capture_protection {
        return current;
    }
    apply_capture_protection(state.capture.as_ref(), next);
    tracing::info!(
        enabled = next,
        "capture protection applied for the open account"
    );
    state.locker.update_config(|c| c.capture_protection = next)
}

/// Why the vault last locked (button or Ctrl+L, idle, Windows lock, sleep),
/// so the lock screen can say so. Returns it once, then `None`.
#[tauri::command]
#[specta::specta]
pub fn session_take_lock_notice(state: State<'_, AppState>) -> Option<LockNotice> {
    state.locker.take_notice()
}
