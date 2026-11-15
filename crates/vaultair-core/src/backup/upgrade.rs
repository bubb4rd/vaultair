//! The backup an unlock makes before it upgrades a vault's schema (plan
//! §2.4; docs/backup-restore.md, "Before an upgrade"). It is an ordinary
//! backup file, written before the first migration runs, so it holds the
//! vault at the schema the older Vaultair wrote, and restoring it with that
//! Vaultair is the way back.
//!
//! It goes to `%LOCALAPPDATA%\Vaultair\upgrade-backups`, never the user's
//! backup folder: that may be on a drive that isn't connected, and an upgrade
//! must not depend on it. These copies aren't the user's backups (they don't
//! change `last_backup_at` or "Backup due") and are never deleted for them.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::create::{write_backup, WriteError};
use super::verify::verify_backup;
use crate::clock::Clock;
use crate::crypto::keys::VaultKeys;
use crate::vault::error::{UpgradeBackupFailure, VaultError};
use crate::vault::header::VaultHeader;
use crate::vault::layout::VaultPaths;

/// The folder under `%LOCALAPPDATA%\Vaultair` that holds the backups.
pub const UPGRADE_BACKUPS_DIR: &str = "upgrade-backups";

/// Where an unlock that will upgrade a vault writes its backup first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeBackups {
    /// The backups. Created when the first one is written.
    pub dir: PathBuf,
    /// Where a backup's database is copied (still encrypted) to check it.
    pub scratch_dir: PathBuf,
}

impl UpgradeBackups {
    /// `app_dir` is `%LOCALAPPDATA%\Vaultair`. The copy is checked in its
    /// `tmp` folder, like a backup made with Back up now.
    pub fn in_app_dir(app_dir: &Path) -> Self {
        Self {
            dir: app_dir.join(UPGRADE_BACKUPS_DIR),
            scratch_dir: app_dir.join("tmp"),
        }
    }
}

fn failure(kind: io::ErrorKind) -> VaultError {
    VaultError::UpgradeBackup(match kind {
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => UpgradeBackupFailure::DiskFull,
        _ => UpgradeBackupFailure::NotWritable,
    })
}

/// Backs up the vault in `paths`, whose database `conn` has open and no
/// migration has touched yet, into `backups.dir`, then reads the backup back
/// the way Back up now does: the MAC over the whole file and every database
/// page. A backup that doesn't read back is removed. `None` (no app-data
/// folder) means there is nowhere to write one.
pub(crate) fn back_up_before_upgrade(
    conn: &Connection,
    paths: &VaultPaths,
    keys: &VaultKeys,
    header: &VaultHeader,
    backups: Option<&UpgradeBackups>,
    clock: &dyn Clock,
) -> Result<PathBuf, VaultError> {
    let Some(backups) = backups.filter(|b| b.dir.is_absolute()) else {
        tracing::warn!("no folder for the backup before an upgrade");
        return Err(VaultError::UpgradeBackup(UpgradeBackupFailure::NotWritable));
    };
    fs::create_dir_all(&backups.dir).map_err(|e| {
        tracing::warn!(kind = ?e.kind(), "could not create the upgrade backups folder");
        failure(e.kind())
    })?;

    // `display_name` is in every schema since V1; a damaged row just gets the
    // fallback name.
    let name: String = conn
        .query_row(
            "SELECT display_name FROM vault_meta WHERE id = 'singleton'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let file = write_backup(
        conn,
        paths,
        keys,
        header,
        &name,
        &backups.dir,
        clock.now_utc(),
    )
    .map_err(|e| match e {
        WriteError::Vault(e) => e,
        WriteError::Destination(kind) => failure(kind),
    })?;

    if let Err(e) = verify_backup(&file.path, keys, &header.vault_id, &backups.scratch_dir) {
        tracing::error!(error = %e, "the backup before an upgrade did not read back and was removed");
        let _ = fs::remove_file(&file.path);
        return Err(match e {
            VaultError::Io(kind) => failure(kind),
            _ => VaultError::UpgradeBackup(UpgradeBackupFailure::Unreadable),
        });
    }
    tracing::info!(
        size_bytes = file.size_bytes,
        "backup made before a schema upgrade"
    );
    Ok(file.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_disk_is_told_apart_from_an_unwritable_folder() {
        for (kind, reason) in [
            (io::ErrorKind::StorageFull, UpgradeBackupFailure::DiskFull),
            (io::ErrorKind::QuotaExceeded, UpgradeBackupFailure::DiskFull),
            (
                io::ErrorKind::PermissionDenied,
                UpgradeBackupFailure::NotWritable,
            ),
            (
                io::ErrorKind::NotADirectory,
                UpgradeBackupFailure::NotWritable,
            ),
        ] {
            assert_eq!(failure(kind), VaultError::UpgradeBackup(reason), "{kind:?}");
        }
    }

    #[test]
    fn the_folders_are_under_the_app_folder() {
        let app = Path::new(r"C:\Users\sam\AppData\Local\Vaultair");
        let b = UpgradeBackups::in_app_dir(app);
        assert_eq!(b.dir, app.join("upgrade-backups"));
        assert_eq!(b.scratch_dir, app.join("tmp"));
    }
}
