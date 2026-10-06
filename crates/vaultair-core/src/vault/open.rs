use std::fs;
use std::path::Path;

use secrecy::SecretString;

use super::device_slot::{header_binding, Binding};
use super::error::{CorruptPart, VaultError};
use super::header::VaultHeader;
use super::layout::VaultPaths;
use super::lockfile::VaultLock;
use super::{rekey, OpenVault};
use crate::crypto::keys::{Dek, VaultKeys};
use crate::crypto::{aead, kdf};
use crate::db;
use crate::domain::identity::IdentityColor;

/// The checks that depend only on the files being there.
fn locate(dir: &Path) -> Result<VaultPaths, VaultError> {
    if !dir.is_absolute() {
        return Err(VaultError::InvalidLocation);
    }
    if !dir.is_dir() {
        return Err(VaultError::NotFound);
    }
    let paths = VaultPaths::new(dir);
    if !paths.header.is_file() {
        return Err(VaultError::HeaderMissing);
    }
    if !paths.db.is_file() {
        return Err(VaultError::DatabaseMissing);
    }
    Ok(paths)
}

/// Reads the header of the vault in `dir` without opening or locking it.
/// The header holds no user data and no secrets.
pub fn read_header(dir: &Path) -> Result<VaultHeader, VaultError> {
    let paths = locate(dir)?;
    VaultHeader::decode(&fs::read(&paths.header)?)
}

/// Unwraps the data key with the master password. One Argon2 run; touches
/// no files.
pub fn unwrap_dek(header: &VaultHeader, password: &SecretString) -> Result<Dek, VaultError> {
    let slot = header.password_slot()?;
    let kek = kdf::derive_kek(password, &slot.salt, slot.params)?;
    let dek = aead::open(&kek, &slot.nonce, &header.aad(), &slot.ciphertext)
        .map_err(|_| VaultError::WrongPasswordOrTampered)?;
    Ok(Dek::from_bytes(&dek)?)
}

/// Unlocks the vault in `dir`.
///
/// Every check before Argon2 depends only on the files, never on the
/// password, so timing reveals nothing about a wrong password beyond "wrong".
pub fn open_vault(dir: &Path, password: &SecretString) -> Result<OpenVault, VaultError> {
    let paths = locate(dir)?;
    let lock = VaultLock::acquire(&paths.lock)?;
    let header = VaultHeader::decode(&fs::read(&paths.header)?)?;
    let keys = VaultKeys::derive(unwrap_dek(&header, password)?)?;
    open_with_keys(paths, lock, header, keys)
}

/// Unlocks the vault in `dir` with keys a device slot gave back
/// (`vault::device_slot`). `binding` is the header those keys were unwrapped
/// against; if the header on disk is a different one now, nothing opens.
pub fn open_vault_with_keys(
    dir: &Path,
    keys: VaultKeys,
    binding: &Binding,
) -> Result<OpenVault, VaultError> {
    let paths = locate(dir)?;
    let lock = VaultLock::acquire(&paths.lock)?;
    let header = VaultHeader::decode(&fs::read(&paths.header)?)?;
    if &header_binding(&header) != binding {
        return Err(VaultError::WrongPasswordOrTampered);
    }
    open_with_keys(paths, lock, header, keys)
}

fn open_with_keys(
    paths: VaultPaths,
    lock: VaultLock,
    header: VaultHeader,
    keys: VaultKeys,
) -> Result<OpenVault, VaultError> {
    let mut conn = db::connection::open(&paths.db, &keys, false)?;
    if !db::connection::integrity_ok(&conn)? {
        return Err(VaultError::Corrupted(CorruptPart::Database));
    }
    db::migrate::run(&mut conn)?;

    let (meta_id, name, color): (String, String, Option<String>) = conn
        .query_row(
            "SELECT vault_id, display_name, color FROM vault_meta WHERE id = 'singleton'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| VaultError::Corrupted(CorruptPart::Database))?;
    if meta_id != header.vault_id {
        return Err(VaultError::Corrupted(CorruptPart::Database));
    }
    rekey::clean_leftovers(&paths);

    tracing::info!("vault unlocked");
    Ok(OpenVault {
        conn,
        keys,
        header,
        paths,
        name,
        // An unknown colour (from a newer build) shows as no colour.
        color: color.as_deref().and_then(IdentityColor::parse),
        _lock: lock,
    })
}
