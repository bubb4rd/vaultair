use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::container::{self, EXTENSION};
use crate::clock::Clock;
use crate::crypto::keys::VaultKeys;
use crate::vault::error::VaultError;
use crate::vault::header::VaultHeader;
use crate::vault::layout::{validate_name, VaultPaths};
use crate::vault::OpenVault;

/// A backup that was just written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupFile {
    pub path: PathBuf,
    /// RFC 3339 UTC, the same instant as in the file name.
    pub created_at: String,
    pub size_bytes: u64,
}

/// `<VaultName>-YYYYMMDD-HHMMSS` (UTC).
fn file_stem(vault_name: &str, now: OffsetDateTime) -> String {
    // The name is a folder name already; anything else came from a damaged vault.
    let name = if validate_name(vault_name) {
        vault_name
    } else {
        "Vault"
    };
    format!(
        "{name}-{:04}{:02}{:02}-{:02}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

/// A name in `dir` that isn't taken: a second backup in the same second gets
/// `-2`. An existing backup is never overwritten.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{EXTENSION}"));
    if !first.exists() {
        return first;
    }
    (2u32..)
        .map(|n| dir.join(format!("{stem}-{n}.{EXTENSION}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Why `write_backup` wrote nothing.
#[derive(Debug)]
pub(crate) enum WriteError {
    /// The vault's own files couldn't be read.
    Vault(VaultError),
    /// The destination couldn't take the file.
    Destination(io::ErrorKind),
}

impl From<VaultError> for WriteError {
    fn from(e: VaultError) -> Self {
        Self::Vault(e)
    }
}

impl From<rusqlite::Error> for WriteError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Vault(e.into())
    }
}

/// Writes a backup of the vault in `paths`, whose database `conn` has open
/// with `keys`, into `dest_dir` (which must exist). `header` is the header
/// that was read when the vault was opened. No `OpenVault` is needed, so an
/// unlock can back a vault up before upgrading it (`backup::upgrade`).
///
/// The database is copied as it is on disk, under a read transaction so
/// nothing can change it part-way. (SQLCipher refuses SQLite's online backup
/// API on encrypted databases.) The caller holds the vault's `.lock`, so no
/// write of ours is in flight, and `journal_mode = DELETE` means the file
/// alone is the whole database. The backup is written to a `.tmp` file and
/// renamed.
pub(crate) fn write_backup(
    conn: &Connection,
    paths: &VaultPaths,
    keys: &VaultKeys,
    header: &VaultHeader,
    vault_name: &str,
    dest_dir: &Path,
    now: OffsetDateTime,
) -> Result<BackupFile, WriteError> {
    let created_at = now
        .format(&Rfc3339)
        .map_err(|_| VaultError::Io(io::ErrorKind::Other))?;

    // The header as it is on disk now: it's what opens this database.
    let header_bytes = fs::read(&paths.header).map_err(VaultError::from)?;
    if VaultHeader::decode(&header_bytes)?.vault_id != header.vault_id {
        return Err(VaultError::Corrupted(crate::vault::CorruptPart::Header).into());
    }

    let read = conn.unchecked_transaction()?;
    read.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })?;
    let mut db = File::open(&paths.db).map_err(VaultError::from)?;
    let db_len = db.metadata().map_err(VaultError::from)?.len();

    let target = free_path(dest_dir, &file_stem(vault_name, now));
    let tmp = target.with_extension(format!("{EXTENSION}.tmp"));
    let written = (|| {
        let mut out = File::create(&tmp)?;
        let size = container::write(
            &mut out,
            keys.backup_key(),
            &created_at,
            &header.vault_id,
            &header_bytes,
            &mut db,
            db_len,
        )?;
        out.sync_all()?;
        drop(out);
        fs::rename(&tmp, &target)?;
        Ok::<u64, io::Error>(size)
    })();
    drop(read);

    match written {
        Ok(size_bytes) => {
            tracing::info!(size_bytes, "backup written");
            Ok(BackupFile {
                path: target,
                created_at,
                size_bytes,
            })
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            tracing::warn!(kind = ?e.kind(), "backup could not be written");
            Err(WriteError::Destination(e.kind()))
        }
    }
}

/// Writes a backup of the unlocked vault into `dest_dir` (see `write_backup`).
pub fn create_backup(
    vault: &OpenVault,
    dest_dir: &Path,
    clock: &dyn Clock,
) -> Result<BackupFile, VaultError> {
    if !dest_dir.is_absolute() || !dest_dir.is_dir() {
        return Err(VaultError::BackupDestination);
    }
    write_backup(
        vault.conn(),
        vault.paths(),
        vault.keys(),
        vault.header(),
        &vault.info().name,
        dest_dir,
        clock.now_utc(),
    )
    .map_err(|e| match e {
        WriteError::Vault(e) => e,
        WriteError::Destination(_) => VaultError::BackupDestination,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names() {
        let at = OffsetDateTime::from_unix_timestamp(1_791_184_089).unwrap();
        assert_eq!(file_stem("Main vault", at), "Main vault-20261005-070809");
        assert_eq!(file_stem("a/b", at), "Vault-20261005-070809");
    }

    #[test]
    fn an_existing_backup_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let first = free_path(dir.path(), "V-1");
        assert_eq!(first, dir.path().join("V-1.vaultair-backup"));
        fs::write(&first, b"x").unwrap();
        let second = free_path(dir.path(), "V-1");
        assert_eq!(second, dir.path().join("V-1-2.vaultair-backup"));
        fs::write(&second, b"x").unwrap();
        assert_eq!(
            free_path(dir.path(), "V-1"),
            dir.path().join("V-1-3.vaultair-backup")
        );
    }
}
