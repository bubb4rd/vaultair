//! Password and passphrase generator (Phase 6). Pure computation in
//! `vaultair_core::generator`; nothing is stored or logged. Copying goes
//! through `clipboard_copy_plain`, which auto-clears.

use vaultair_core::generator::{self, Generated, PassphraseOptions, PasswordOptions};

use crate::state::{ipc_err, IpcResult};

#[tauri::command]
#[specta::specta]
pub fn generate_password(options: PasswordOptions) -> IpcResult<Generated> {
    generator::generate_password(&options).map_err(ipc_err)
}

#[tauri::command]
#[specta::specta]
pub fn generate_passphrase(options: PassphraseOptions) -> IpcResult<Generated> {
    generator::generate_passphrase(&options).map_err(ipc_err)
}
