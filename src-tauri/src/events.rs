//! Events Rust pushes to the webview. Types are exported to `bindings.ts`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_specta::Event;

/// The vault was locked (by the user, or later by auto-lock and OS session
/// events). The UI reacts by reloading the webview, which discards every
/// value the JS heap held while unlocked.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
#[tauri_specta(event_name = "vault://locked")]
pub struct VaultLocked;

/// Locks the session and tells the UI. Every lock path goes through here.
pub fn lock_and_notify(
    app: &AppHandle,
    session: &vaultair_core::service::session::SessionManager,
) -> bool {
    let was_open = session.lock();
    if let Err(err) = VaultLocked.emit(app) {
        tracing::error!(error = %err, "could not emit vault locked event");
    }
    was_open
}
