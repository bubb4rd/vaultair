use std::fs;
use std::path::Path;

use secrecy::SecretString;

use super::error::{CorruptPart, VaultError};
use super::header::VaultHeader;
use super::layout::VaultPaths;
use super::lockfile::VaultLock;
use super::{rekey, OpenVault};
use crate::crypto::keys::{Dek, VaultKeys};
use crate::crypto::{aead, kdf};
use crate::db;
use crate::domain::identity::IdentityColor;

/// Unlocks the vault in `dir`.
///
/// Every check before Argon2 depends only on the files, never on the
/// password, so timing reveals nothing about a wrong password beyond "wrong".
pub fn open_vault(dir: &Path, password: &SecretString) -> Result<OpenVault, VaultError> {
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
    let lock = VaultLock::acquire(&paths.lock)?;

    let header = VaultHeader::decode(&fs::read(&paths.header)?)?;
    let slot = header.password_slot()?;

    let kek = kdf::derive_kek(password, &slot.salt, slot.params)?;
    let dek_bytes = aead::open(&kek, &slot.nonce, &header.aad(), &slot.ciphertext)
        .map_err(|_| VaultError::WrongPasswordOrTampered)?;
    let keys = VaultKeys::derive(Dek::from_bytes(&dek_bytes)?)?;

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
