use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::container::{self, EXTENSION};
use crate::clock::Clock;
use crate::vault::error::VaultError;
use crate::vault::header::VaultHeader;
use crate::vault::layout::validate_name;
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

/// Writes a backup of the unlocked vault into `dest_dir`.
///
/// The database is copied as it is on disk, under a read transaction so
/// nothing can change it part-way. (SQLCipher refuses SQLite's online backup
/// API on encrypted databases.) The caller holds the vault, so no write of
/// ours is in flight, and `journal_mode = DELETE` means the file alone is the
/// whole database. The backup is written to a `.tmp` file and renamed.
pub fn create_backup(
    vault: &OpenVault,
    dest_dir: &Path,
    clock: &dyn Clock,
) -> Result<BackupFile, VaultError> {
    if !dest_dir.is_absolute() || !dest_dir.is_dir() {
        return Err(VaultError::BackupDestination);
    }
    let now = clock.now_utc();
    let created_at = now
        .format(&Rfc3339)
        .map_err(|_| VaultError::Io(io::ErrorKind::Other))?;
    let paths = vault.paths();

    // The header as it is on disk now: it's what opens this database.
    let header = fs::read(&paths.header)?;
    if VaultHeader::decode(&header)?.vault_id != vault.header().vault_id {
        return Err(VaultError::Corrupted(crate::vault::CorruptPart::Header));
    }

    let read = vault.conn().unchecked_transaction()?;
    read.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })?;
    let mut db = File::open(&paths.db)?;
    let db_len = db.metadata()?.len();

    let target = free_path(dest_dir, &file_stem(&vault.info().name, now));
    let tmp = target.with_extension(format!("{EXTENSION}.tmp"));
    let written = (|| {
        let mut out = File::create(&tmp)?;
        let size = container::write(
            &mut out,
            vault.keys().backup_key(),
            &created_at,
            &vault.header().vault_id,
            &header,
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
            Err(VaultError::BackupDestination)
        }
    }
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
