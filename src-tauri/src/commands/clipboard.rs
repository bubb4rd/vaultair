//! Clipboard commands. Every copy is kept out of clipboard history and
//! cleared automatically (see `crate::clipboard`).
//!
//! `clipboard_copy_plain` takes text the UI already shows (a username or
//! email). Secrets never pass through here: Phase 7's
//! `clipboard_copy_secret` decrypts in Rust and copies directly.

use serde::Serialize;
use tauri::State;
use vaultair_core::service::session::VaultStatus;
use vaultair_core::AppError;
use vaultair_platform::PlatformError;

use crate::state::{ipc_err, AppState, IpcResult};

/// Longer than any username, email or URL the UI shows.
const MAX_PLAIN_CHARS: usize = 4096;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCopy {
    /// The clipboard is cleared this many seconds from now.
    pub clear_after_secs: u32,
}

fn platform_err(err: PlatformError) -> AppError {
    match err {
        PlatformError::ClipboardBusy => AppError::ClipboardBusy,
        PlatformError::Unsupported | PlatformError::Os { .. } => AppError::Internal {
            context: "clipboard",
        },
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))
}

/// Copies non-secret text shown in the UI. Only while unlocked.
#[tauri::command]
#[specta::specta]
pub async fn clipboard_copy_plain(
    state: State<'_, AppState>,
    text: String,
) -> IpcResult<ClipboardCopy> {
    if state.session.status() == VaultStatus::Locked {
        return Err(ipc_err(AppError::VaultLocked));
    }
    let chars = text.chars().count();
    if chars == 0 || chars > MAX_PLAIN_CHARS {
        return Err(ipc_err(AppError::InvalidInput { field: "text" }));
    }
    let config = state.locker.config();
    let clipboard = state.clipboard.clone();
    blocking(move || clipboard.copy(&text, config.clipboard_clear()))
        .await?
        .map_err(|e| ipc_err(platform_err(e)))?;
    Ok(ClipboardCopy {
        clear_after_secs: config.clipboard_clear_secs,
    })
}

/// "Keep in clipboard": cancels the pending clear. Returns false if none was pending.
#[tauri::command]
#[specta::specta]
pub fn clipboard_cancel_clear(state: State<'_, AppState>) -> bool {
    let cancelled = state.clipboard.cancel();
    if cancelled {
        tracing::info!("clipboard clear cancelled by the user");
    }
    cancelled
}

/// Clears our value from the clipboard now. Returns whether it cleared.
#[tauri::command]
#[specta::specta]
pub async fn clipboard_clear_now(state: State<'_, AppState>) -> IpcResult<bool> {
    let clipboard = state.clipboard.clone();
    blocking(move || clipboard.clear_now()).await
}
