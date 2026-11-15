use std::fs;
use std::path::Path;

use secrecy::SecretString;

use super::device_slot::{header_binding, Binding};
use super::error::{CorruptPart, VaultError};
use super::header::VaultHeader;
use super::layout::VaultPaths;
use super::lockfile::VaultLock;
use super::{rekey, OpenVault};
use crate::backup::{self, UpgradeBackups};
use crate::clock::SystemClock;
use crate::crypto::keys::{Dek, VaultKeys};
use crate::crypto::{aead, kdf};
use crate::db::{self, migrate};
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
///
/// A vault made by an older Vaultair is backed up into `upgrade_backups`
/// before its schema is upgraded (`backup::upgrade`). If that fails, the
/// vault stays as it was and `VaultError::UpgradeBackup` says why; `None`
/// means there is nowhere to write the backup, so such a vault won't open.
pub fn open_vault(
    dir: &Path,
    password: &SecretString,
    upgrade_backups: Option<&UpgradeBackups>,
) -> Result<OpenVault, VaultError> {
    open_with_password(dir, password, upgrade_backups, &[])
}

/// `open_vault` as a build with `extra` migrations after the real ones, so
/// tests can upgrade a vault without a real new migration. Test-only.
#[cfg(feature = "test-support")]
pub fn open_vault_with_extra_migrations(
    dir: &Path,
    password: &SecretString,
    upgrade_backups: Option<&UpgradeBackups>,
    extra: &[&str],
) -> Result<OpenVault, VaultError> {
    open_with_password(dir, password, upgrade_backups, extra)
}

fn open_with_password(
    dir: &Path,
    password: &SecretString,
    upgrade_backups: Option<&UpgradeBackups>,
    extra_migrations: &[&str],
) -> Result<OpenVault, VaultError> {
    let paths = locate(dir)?;
    let lock = VaultLock::acquire(&paths.lock)?;
    let header = VaultHeader::decode(&fs::read(&paths.header)?)?;
    let keys = VaultKeys::derive(unwrap_dek(&header, password)?)?;
    open_with_keys(paths, lock, header, keys, upgrade_backups, extra_migrations)
}

/// Unlocks the vault in `dir` with keys a device slot gave back
/// (`vault::device_slot`). `binding` is the header those keys were unwrapped
/// against; if the header on disk is a different one now, nothing opens.
/// `upgrade_backups` as for `open_vault`.
pub fn open_vault_with_keys(
    dir: &Path,
    keys: VaultKeys,
    binding: &Binding,
    upgrade_backups: Option<&UpgradeBackups>,
) -> Result<OpenVault, VaultError> {
    let paths = locate(dir)?;
    let lock = VaultLock::acquire(&paths.lock)?;
    let header = VaultHeader::decode(&fs::read(&paths.header)?)?;
    if &header_binding(&header) != binding {
        return Err(VaultError::WrongPasswordOrTampered);
    }
    open_with_keys(paths, lock, header, keys, upgrade_backups, &[])
}

/// On any error the connection closes and `lock` is released as this returns.
fn open_with_keys(
    paths: VaultPaths,
    lock: VaultLock,
    header: VaultHeader,
    keys: VaultKeys,
    upgrade_backups: Option<&UpgradeBackups>,
    extra_migrations: &[&str],
) -> Result<OpenVault, VaultError> {
    let mut conn = db::connection::open(&paths.db, &keys, false)?;
    if !db::connection::integrity_ok(&conn)? {
        return Err(VaultError::Corrupted(CorruptPart::Database));
    }
    // Version 0 is a new database with nothing to lose; a newer one than we
    // know is refused by `run_with` below.
    let version = migrate::current_version(&conn)?;
    if version > 0 && version < migrate::latest_with(extra_migrations) {
        backup::back_up_before_upgrade(
            &conn,
            &paths,
            &keys,
            &header,
            upgrade_backups,
            &SystemClock,
        )?;
    }
    migrate::run_with(&mut conn, extra_migrations)?;

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
