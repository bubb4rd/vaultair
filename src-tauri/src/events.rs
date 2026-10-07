//! Events Rust pushes to the webview. Types are exported to `bindings.ts`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_specta::Event;

/// The vault was locked: by the user, the idle timer, or an OS event (see
/// `lock::Locker`). The UI reacts by reloading the webview, which discards
/// every value the JS heap held while unlocked.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
#[tauri_specta(event_name = "vault://locked")]
pub struct VaultLocked;

/// A pending clipboard clear finished (timer, "Clear now", or lock). The UI
/// dismisses its countdown.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
#[tauri_specta(event_name = "clipboard://cleared")]
pub struct ClipboardCleared;

/// Emits `event`, logging (not failing) if the webview is gone.
pub fn emit<E: Event + Serialize + Clone>(app: &AppHandle, event: E) {
    if let Err(err) = event.emit(app) {
        tracing::error!(
            kind = %crate::logging::error_kind(&err),
            "could not emit event"
        );
    }
}
