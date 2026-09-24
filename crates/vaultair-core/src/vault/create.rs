use std::fs;
use std::path::PathBuf;

use rusqlite::params;
use secrecy::SecretString;

use super::atomic_write::write_atomic;
use super::error::VaultError;
use super::header::VaultHeader;
use super::layout::{validate_name, VaultPaths};
use super::lockfile::VaultLock;
use super::OpenVault;
use crate::clock::Clock;
use crate::crypto::kdf::{self, KdfParams, SALT_LEN};
use crate::crypto::keys::{Dek, VaultKeys};
use crate::crypto::password::check_master_password;
use crate::crypto::{aead, rng};
use crate::db;

#[derive(Debug, Clone)]
pub struct CreateOptions {
    /// Folder the vault folder is created in, e.g. `%LOCALAPPDATA%\Vaultair\Vaults`.
    pub parent_dir: PathBuf,
    /// Display name, also the vault folder name.
    pub name: String,
    pub kdf: KdfParams,
    pub demo: bool,
}

/// Creates a vault and returns it unlocked.
///
/// The database is written first and the header last, so a crash part-way
/// leaves a folder without a header (reported as "not found"), never a
/// header pointing at a half-built database.
pub fn create_vault(
    opts: &CreateOptions,
    password: &SecretString,
    clock: &dyn Clock,
) -> Result<OpenVault, VaultError> {
    check_master_password(password).map_err(VaultError::WeakPassword)?;
    if !validate_name(&opts.name) {
        return Err(VaultError::InvalidName);
    }
    if !opts.parent_dir.is_absolute() {
        return Err(VaultError::InvalidLocation);
    }
    opts.kdf.validate()?;

    let paths = VaultPaths::new(opts.parent_dir.join(&opts.name));
    if paths.dir.exists() {
        let empty = fs::read_dir(&paths.dir)?.next().is_none();
        if !empty {
            return Err(VaultError::AlreadyExists);
        }
    }
    fs::create_dir_all(&paths.dir)?;

    match build(opts, &paths, password, clock) {
        Ok(vault) => Ok(vault),
        Err(e) => {
            // Leave nothing half-made behind. We verified the folder was new or empty.
            let _ = fs::remove_dir_all(&paths.dir);
            Err(e)
        }
    }
}

fn build(
    opts: &CreateOptions,
    paths: &VaultPaths,
    password: &SecretString,
    clock: &dyn Clock,
) -> Result<OpenVault, VaultError> {
    let lock = VaultLock::acquire(&paths.lock)?;
    let now = clock.now_rfc3339();
    let vault_id = uuid::Uuid::now_v7().to_string();
    let salt = rng::bytes::<SALT_LEN>()?;
    let mut header = VaultHeader::new(vault_id.clone(), now.clone(), opts.kdf, &salt, opts.demo);

    let dek = Dek::generate()?;
    let kek = kdf::derive_kek(password, &salt, opts.kdf)?;
    let (nonce, wrapped) = aead::seal(&kek, &header.aad(), dek.as_bytes())?;
    header.set_wrap(&nonce, &wrapped);
    let keys = VaultKeys::derive(dek)?;

    let mut conn = db::connection::open(&paths.db, &keys, true)?;
    db::migrate::run(&mut conn)?;
    conn.execute(
        "INSERT INTO vault_meta (id, vault_id, display_name, encryption_version, kdf_summary, created_at, updated_at)
         VALUES ('singleton', ?1, ?2, 1, ?3, ?4, ?4)",
        params![vault_id, opts.name, opts.kdf.summary(), now],
    )?;

    write_atomic(&paths.header, &paths.header_tmp, &header.encode())?;
    tracing::info!(kdf = %opts.kdf.summary(), demo = opts.demo, "vault created");

    Ok(OpenVault {
        conn,
        keys,
        header,
        paths: paths.clone(),
        name: opts.name.clone(),
        _lock: lock,
    })
}
