use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::container::Container;
use crate::crypto::keys::VaultKeys;
use crate::db;
use crate::vault::error::VaultError;

/// What a backup file says about itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupInfo {
    pub vault_id: String,
    /// RFC 3339 UTC.
    pub created_at: String,
    pub size_bytes: u64,
}

impl BackupInfo {
    fn of(container: &Container) -> Self {
        Self {
            vault_id: container.vault_id.clone(),
            created_at: container.created_at.clone(),
            size_bytes: container.size,
        }
    }
}

/// Reads a backup's vault id and date without a password. Only the file's
/// structure is checked; nothing here is authenticated until the backup is
/// verified or restored.
pub fn inspect_backup(path: &Path) -> Result<BackupInfo, VaultError> {
    Ok(BackupInfo::of(&Container::open(path)?))
}

/// A database that fails to open or check out inside a backup is a bad
/// backup, not a damaged vault.
fn as_invalid(e: VaultError) -> VaultError {
    match e {
        VaultError::Corrupted(_) => VaultError::InvalidBackup,
        other => other,
    }
}

fn open_checked(
    db_path: &Path,
    keys: &VaultKeys,
    vault_id: &str,
) -> Result<Connection, VaultError> {
    let conn = db::connection::open(db_path, keys, false).map_err(as_invalid)?;
    if !db::connection::integrity_ok(&conn).map_err(as_invalid)? {
        return Err(VaultError::InvalidBackup);
    }
    if db::migrate::current_version(&conn)? > db::migrate::latest_version() {
        return Err(VaultError::TooNew);
    }
    let meta_id: String = conn
        .query_row(
            "SELECT vault_id FROM vault_meta WHERE id = 'singleton'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| VaultError::InvalidBackup)?;
    if meta_id != vault_id {
        return Err(VaultError::InvalidBackup);
    }
    Ok(conn)
}

/// Writes the backup's database to `db_path` (which must not exist), checks
/// the MAC over the whole file, then opens the copy and checks every page's
/// HMAC, the SQLite structure and that it is the header's vault. On failure
/// the copy is removed.
pub(crate) fn extract_checked(
    container: Container,
    keys: &VaultKeys,
    db_path: &Path,
) -> Result<Connection, VaultError> {
    let vault_id = container.vault_id.clone();
    let mut out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(db_path)?;
    let copied = container
        .extract_db(keys.backup_key(), &mut out)
        .and_then(|()| Ok(out.sync_all()?));
    drop(out);
    let result = copied.and_then(|()| open_checked(db_path, keys, &vault_id));
    if result.is_err() {
        let _ = fs::remove_file(db_path);
    }
    result
}

/// A scratch copy, removed when dropped.
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

const SCRATCH_PREFIX: &str = "verify-";
const SCRATCH_SUFFIX: &str = ".vdb";

/// Removes copies a crash left behind. They are SQLCipher files, never plaintext.
fn clear_stale(scratch_dir: &Path) {
    let Ok(entries) = fs::read_dir(scratch_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(SCRATCH_PREFIX) && name.ends_with(SCRATCH_SUFFIX) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Checks that `path` is an intact backup of the vault `keys` belong to: the
/// MAC over the whole file, then every database page. The database is copied
/// into `scratch_dir` to be opened (still encrypted) and removed afterwards.
///
/// A backup of another vault is `BackupOtherVault`: its MAC key comes from
/// that vault's own key, so only a restore (with its password) can check it.
pub fn verify_backup(
    path: &Path,
    keys: &VaultKeys,
    vault_id: &str,
    scratch_dir: &Path,
) -> Result<BackupInfo, VaultError> {
    let container = Container::open(path)?;
    if container.vault_id != vault_id {
        return Err(VaultError::BackupOtherVault);
    }
    let info = BackupInfo::of(&container);

    fs::create_dir_all(scratch_dir)?;
    clear_stale(scratch_dir);
    let scratch = Scratch(scratch_dir.join(format!(
        "{SCRATCH_PREFIX}{}{SCRATCH_SUFFIX}",
        uuid::Uuid::now_v7()
    )));
    // Close the copy before `scratch` removes it.
    drop(extract_checked(container, keys, &scratch.0)?);
    Ok(info)
}
