pub mod account;
pub mod app;
pub mod backup;
pub mod catalog;
pub mod clipboard;
pub mod generator;
pub mod graph;
pub mod health;
pub mod identity;
pub mod mfa;
pub mod password;
pub mod recent;
pub mod search;
pub mod secret;
pub mod session;
pub mod settings;
pub mod vault;

use vaultair_core::vault::OpenVault;
use vaultair_core::AppError;

use crate::state::{ipc_err, AppState, IpcResult};

/// Runs `f` against the unlocked vault on a worker thread (SQLCipher and
/// field crypto shouldn't block the async runtime). Locked: `vault_locked`.
pub(crate) async fn with_vault<T: Send + 'static>(
    state: &AppState,
    f: impl FnOnce(&mut OpenVault) -> Result<T, AppError> + Send + 'static,
) -> IpcResult<T> {
    let session = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || session.with_vault(f))
        .await
        .map_err(|_| ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(ipc_err)
}
