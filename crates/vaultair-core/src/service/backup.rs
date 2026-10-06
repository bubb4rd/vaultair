//! Backups of the unlocked vault: where they go, making one, and what
//! happened last time. The file format and the checks are in `crate::backup`.
//!
//! The destination and the last result are kept in the vault's own settings,
//! so they travel with the vault and never sit in plaintext on disk.

use std::fs;
use std::path::Path;

use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

use crate::backup::{self, BackupFile, BackupInfo};
use crate::clock::Clock;
use crate::db::repo::settings;
use crate::vault::location::{CloudProvider, CloudRoots};
use crate::vault::{OpenVault, VaultError};
use crate::AppError;

/// A backup older than this (or none at all) is worth a reminder.
pub const REMINDER_AFTER_DAYS: u32 = 30;

const KEY_DIR: &str = "backup_dir";
const KEY_LAST_AT: &str = "last_backup_at";
const KEY_LAST_PATH: &str = "last_backup_path";
const KEY_LAST_STATUS: &str = "last_backup_status";
const KEY_LAST_ATTEMPT: &str = "last_backup_attempt_at";
const STATUS_OK: &str = "ok";
const STATUS_FAILED: &str = "failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum BackupOutcome {
    Ok,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// The folder backups are written to. `None` until the user picks one.
    pub destination: Option<String>,
    /// False when the folder can't be found (a drive that isn't connected).
    pub destination_available: bool,
    /// Set when the folder looks synced to a cloud service (warn, don't block).
    pub cloud_provider: Option<CloudProvider>,
    /// When the last backup that succeeded was made. RFC 3339 UTC.
    pub last_backup_at: Option<String>,
    pub last_backup_path: Option<String>,
    /// How the most recent attempt went, and when.
    pub last_outcome: Option<BackupOutcome>,
    pub last_attempt_at: Option<String>,
    /// No backup yet, or the last one is older than `reminder_after_days`.
    /// Never set for a demo vault.
    pub reminder_due: bool,
    pub reminder_after_days: u32,
}

/// One backup file, as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub path: String,
    pub file_name: String,
    /// RFC 3339 UTC.
    pub created_at: String,
    /// Saturates at 4 GiB; a vault database is a few megabytes.
    pub size_bytes: u32,
}

impl BackupSummary {
    fn new(path: &Path, created_at: String, size_bytes: u64) -> Self {
        Self {
            path: path.display().to_string(),
            file_name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            created_at,
            size_bytes: u32::try_from(size_bytes).unwrap_or(u32::MAX),
        }
    }

    fn of_info(path: &Path, info: BackupInfo) -> Self {
        Self::new(path, info.created_at, info.size_bytes)
    }
}

/// Windows paths: case-insensitive, either separator.
fn normalized(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// `dir` is `base` or somewhere under it.
fn inside(dir: &Path, base: &Path) -> bool {
    let (dir, base) = (normalized(dir), normalized(base));
    dir == base || dir.starts_with(&format!("{base}\\"))
}

fn reminder_due(last_backup_at: Option<&str>, now: OffsetDateTime) -> bool {
    last_backup_at
        .and_then(|at| OffsetDateTime::parse(at, &Rfc3339).ok())
        .is_none_or(|at| now - at >= Duration::days(REMINDER_AFTER_DAYS.into()))
}

pub fn status(
    vault: &OpenVault,
    roots: &CloudRoots,
    now: OffsetDateTime,
) -> Result<BackupStatus, AppError> {
    let conn = vault.conn();
    let destination = settings::get(conn, KEY_DIR)?;
    let last_backup_at = settings::get(conn, KEY_LAST_AT)?;
    let last_outcome = settings::get(conn, KEY_LAST_STATUS)?.map(|s| {
        if s == STATUS_OK {
            BackupOutcome::Ok
        } else {
            BackupOutcome::Failed
        }
    });
    Ok(BackupStatus {
        destination_available: destination
            .as_deref()
            .is_some_and(|d| Path::new(d).is_dir()),
        cloud_provider: destination
            .as_deref()
            .and_then(|d| roots.classify(Path::new(d))),
        reminder_due: !vault.info().demo && reminder_due(last_backup_at.as_deref(), now),
        reminder_after_days: REMINDER_AFTER_DAYS,
        destination,
        last_backup_at,
        last_backup_path: settings::get(conn, KEY_LAST_PATH)?,
        last_outcome,
        last_attempt_at: settings::get(conn, KEY_LAST_ATTEMPT)?,
    })
}

/// Sets (or with `None`, clears) the folder backups go to. It must exist and
/// be outside the vault's own folder: a backup kept inside the vault is lost
/// with it.
pub fn set_destination(
    vault: &mut OpenVault,
    dir: Option<&Path>,
    clock: &dyn Clock,
) -> Result<(), AppError> {
    match dir {
        None => settings::remove(vault.conn(), KEY_DIR)?,
        Some(dir) => {
            if !dir.is_absolute() || inside(dir, vault.dir()) {
                return Err(AppError::InvalidInput {
                    field: "destination",
                });
            }
            if !dir.is_dir() {
                return Err(AppError::BackupDestination);
            }
            settings::set(
                vault.conn(),
                KEY_DIR,
                &dir.display().to_string(),
                &clock.now_rfc3339(),
            )?;
        }
    }
    Ok(())
}

fn record(vault: &mut OpenVault, made: Option<&BackupFile>, now: &str) -> Result<(), AppError> {
    let tx = vault.conn_mut().transaction()?;
    settings::set(&tx, KEY_LAST_ATTEMPT, now, now)?;
    match made {
        Some(file) => {
            settings::set(&tx, KEY_LAST_STATUS, STATUS_OK, now)?;
            settings::set(&tx, KEY_LAST_AT, &file.created_at, now)?;
            settings::set(&tx, KEY_LAST_PATH, &file.path.display().to_string(), now)?;
        }
        None => settings::set(&tx, KEY_LAST_STATUS, STATUS_FAILED, now)?,
    }
    tx.commit()?;
    Ok(())
}

/// Writes a backup into the destination folder, then reads it back: the MAC
/// over the whole file and every database page (`scratch_dir` holds the
/// encrypted copy that is opened for this). A backup that doesn't read back
/// is deleted and reported as a failure. Either way the result is recorded.
pub fn create(
    vault: &mut OpenVault,
    scratch_dir: &Path,
    clock: &dyn Clock,
) -> Result<BackupSummary, AppError> {
    let Some(dir) = settings::get(vault.conn(), KEY_DIR)? else {
        return Err(AppError::InvalidInput {
            field: "destination",
        });
    };
    let vault_id = vault.info().vault_id;
    let made = backup::create_backup(vault, Path::new(&dir), clock).and_then(|file| {
        match backup::verify_backup(&file.path, vault.keys(), &vault_id, scratch_dir) {
            Ok(_) => Ok(file),
            Err(e) => {
                tracing::error!(error = %e, "a new backup did not read back and was removed");
                let _ = fs::remove_file(&file.path);
                Err(VaultError::BackupDestination)
            }
        }
    });

    let now = clock.now_rfc3339();
    match made {
        Ok(file) => {
            record(vault, Some(&file), &now)?;
            Ok(BackupSummary::new(
                &file.path,
                file.created_at,
                file.size_bytes,
            ))
        }
        Err(e) => {
            tracing::warn!(error = %e, "backup failed");
            if record(vault, None, &now).is_err() {
                tracing::warn!("could not record the failed backup");
            }
            Err(e.into())
        }
    }
}

/// Checks a backup of this vault. See [`backup::verify_backup`].
pub fn verify(
    vault: &OpenVault,
    path: &Path,
    scratch_dir: &Path,
) -> Result<BackupSummary, AppError> {
    let info = backup::verify_backup(path, vault.keys(), &vault.info().vault_id, scratch_dir)
        .inspect_err(|e| tracing::warn!(error = %e, "backup verification failed"))?;
    Ok(BackupSummary::of_info(path, info))
}

/// What a backup file says about itself, before any password is asked for.
/// Not authenticated; a restore checks everything.
pub fn inspect(path: &Path) -> Result<BackupSummary, AppError> {
    Ok(BackupSummary::of_info(path, backup::inspect_backup(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inside_ignores_case_and_separators() {
        let base = Path::new(r"C:\Vaults\Main");
        assert!(inside(Path::new(r"c:\vaults\main"), base));
        assert!(inside(Path::new(r"C:\Vaults\Main\backups\"), base));
        assert!(inside(Path::new("C:/Vaults/Main/x"), base));
        assert!(!inside(Path::new(r"C:\Vaults\Main 2"), base));
        assert!(!inside(Path::new(r"C:\Vaults"), base));
        assert!(!inside(Path::new(r"D:\Backups"), base));
    }

    #[test]
    fn reminder_boundaries() {
        let now = OffsetDateTime::parse("2026-10-05T12:00:00Z", &Rfc3339).unwrap();
        assert!(reminder_due(None, now));
        assert!(reminder_due(Some("not a date"), now));
        assert!(!reminder_due(Some("2026-10-05T11:59:59Z"), now));
        assert!(!reminder_due(Some("2026-09-05T12:00:01Z"), now));
        // Exactly the threshold.
        assert!(reminder_due(Some("2026-09-05T12:00:00Z"), now));
    }
}
