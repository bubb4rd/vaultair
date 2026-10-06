use std::fs;
use std::path::PathBuf;

use rusqlite::params;
use secrecy::SecretString;

use super::container::Container;
use super::verify::extract_checked;
use crate::clock::Clock;
use crate::crypto::keys::{Dek, VaultKeys};
use crate::crypto::{aead, kdf};
use crate::vault::atomic_write::write_atomic;
use crate::vault::error::VaultError;
use crate::vault::layout::{validate_name, VaultPaths};
use crate::vault::lockfile::VaultLock;

#[derive(Debug, Clone)]
pub struct RestoreOptions {
    pub backup: PathBuf,
    /// Folder the restored vault's folder is created in.
    pub parent_dir: PathBuf,
    /// The restored vault's name, also its folder name.
    pub name: String,
}

/// Restores a backup into a new vault folder and returns that folder. It
/// never writes over an existing vault: the folder must be new or empty.
///
/// `password` is the master password the vault had when the backup was made.
/// The whole file's MAC and every database page are checked before the
/// header is written, and the header is written last, so a failure or crash
/// leaves no folder that looks like a vault.
pub fn restore_backup(
    opts: &RestoreOptions,
    password: &SecretString,
    clock: &dyn Clock,
) -> Result<PathBuf, VaultError> {
    if !validate_name(&opts.name) {
        return Err(VaultError::InvalidName);
    }
    if !opts.parent_dir.is_absolute() {
        return Err(VaultError::InvalidLocation);
    }
    let paths = VaultPaths::new(opts.parent_dir.join(&opts.name));
    if paths.dir.exists() && fs::read_dir(&paths.dir)?.next().is_some() {
        return Err(VaultError::AlreadyExists);
    }

    // As in `open_vault`: everything before Argon2 depends only on the files.
    let container = Container::open(&opts.backup)?;
    let header = container.header();
    let slot = header
        .password_slot()
        .map_err(|_| VaultError::InvalidBackup)?;
    let kek = kdf::derive_kek(password, &slot.salt, slot.params)?;
    let dek = aead::open(&kek, &slot.nonce, &header.aad(), &slot.ciphertext)
        .map_err(|_| VaultError::WrongPasswordOrTampered)?;
    let keys = VaultKeys::derive(Dek::from_bytes(&dek)?)?;

    fs::create_dir_all(&paths.dir)?;
    match build(container, &keys, &paths, &opts.name, clock) {
        Ok(()) => {
            tracing::info!("backup restored to a new vault folder");
            Ok(paths.dir)
        }
        Err(e) => {
            // Leave nothing half-made behind. We verified the folder was new or empty.
            let _ = fs::remove_dir_all(&paths.dir);
            Err(e)
        }
    }
}

fn build(
    container: Container,
    keys: &VaultKeys,
    paths: &VaultPaths,
    name: &str,
    clock: &dyn Clock,
) -> Result<(), VaultError> {
    let _lock = VaultLock::acquire(&paths.lock)?;
    let header = container.header_bytes().to_vec();
    let conn = extract_checked(container, keys, &paths.db)?;
    // A vault is named after its folder.
    conn.execute(
        "UPDATE vault_meta SET display_name = ?1, updated_at = ?2
         WHERE id = 'singleton' AND display_name <> ?1",
        params![name, clock.now_rfc3339()],
    )?;
    drop(conn);
    write_atomic(&paths.header, &paths.header_tmp, &header)?;
    Ok(())
}
