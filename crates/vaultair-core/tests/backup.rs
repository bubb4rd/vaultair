#![allow(clippy::unwrap_used)] // test helpers
//! Encrypted backups (implementation plan, Phase 14): create, verify and
//! restore to a new folder. Every vault here lives in a temp dir and uses
//! test-only passwords.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::params;
use secrecy::SecretString;
use tempfile::TempDir;
use vaultair_core::backup::{
    create_backup, inspect_backup, restore_backup, verify_backup, RestoreOptions, UpgradeBackups,
};
use vaultair_core::clock::{Clock, ManualClock, SystemClock};
use vaultair_core::crypto::envelope::{self, FieldRef};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::db::migrate;
use vaultair_core::service::backup::{self as service, BackupOutcome, REMINDER_AFTER_DAYS};
use vaultair_core::service::session::SessionManager;
use vaultair_core::vault::layout::{DB_FILE, HEADER_FILE, LOCK_FILE};
use vaultair_core::vault::location::{CloudProvider, CloudRoots};
use vaultair_core::vault::lockfile::VaultLock;
use vaultair_core::vault::{
    create_vault, open_vault, open_vault_with_extra_migrations, CreateOptions, OpenVault,
    UpgradeBackupFailure, VaultError,
};
use vaultair_core::{AppError, ErrorCode};

const PASSWORD: &str = "orbit lantern cactus mosaic";
const SECRET_CANARY: &str = "CANARY7F3A-secret";
const USER_CANARY: &str = "CANARYUSER-handle";

fn pw(s: &str) -> SecretString {
    SecretString::from(s)
}

fn new_vault(parent: &Path, name: &str, demo: bool, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: name.into(),
            kdf: KdfParams::MINIMUM,
            demo,
        },
        &pw(PASSWORD),
        clock,
    )
    .unwrap()
}

/// One account whose password is a field envelope and whose username is
/// plaintext inside SQLCipher.
fn insert_canary_account(v: &mut OpenVault) {
    let field_key = *v.keys().field_key();
    let blob = envelope::seal(
        &field_key,
        FieldRef {
            table: "account",
            column: "password_enc",
            row_id: "a1",
        },
        SECRET_CANARY.as_bytes(),
    )
    .unwrap();
    v.conn_mut()
        .execute(
            "INSERT INTO account (id, title, account_type, purpose_id, username, password_enc, created_at, updated_at)
             VALUES ('a1', 'Main account', 'game', 'builtin-main', ?1, ?2, 'now', 'now')",
            params![USER_CANARY, blob],
        )
        .unwrap();
}

fn canary_secret(v: &OpenVault) -> Vec<u8> {
    let blob: Vec<u8> = v
        .conn()
        .query_row(
            "SELECT password_enc FROM account WHERE id = 'a1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    envelope::open(
        v.keys().field_key(),
        FieldRef {
            table: "account",
            column: "password_enc",
            row_id: "a1",
        },
        &blob,
    )
    .unwrap()
    .to_vec()
}

fn count(v: &OpenVault, table: &str) -> i64 {
    v.conn()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    let n = needle.as_bytes();
    let utf16: Vec<u8> = needle.encode_utf16().flat_map(u16::to_le_bytes).collect();
    haystack.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
        || haystack.windows(utf16.len()).any(|w| w == utf16)
}

fn entries(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|d| {
            d.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

struct Fixture {
    tmp: TempDir,
    vault: OpenVault,
    backups: PathBuf,
    scratch: PathBuf,
}

impl Fixture {
    /// A vault with the demo data and the canary account, and an empty
    /// backup folder beside it.
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let mut vault = new_vault(tmp.path(), "Main", false, &SystemClock);
        vaultair_core::demo::seed(&mut vault, &SystemClock).unwrap();
        insert_canary_account(&mut vault);
        let backups = tmp.path().join("backups");
        fs::create_dir(&backups).unwrap();
        let scratch = tmp.path().join("scratch");
        Self {
            tmp,
            vault,
            backups,
            scratch,
        }
    }

    fn backup(&self) -> PathBuf {
        create_backup(&self.vault, &self.backups, &SystemClock)
            .unwrap()
            .path
    }

    fn verify(&self, path: &Path) -> Result<(), VaultError> {
        verify_backup(
            path,
            self.vault.keys(),
            &self.vault.info().vault_id,
            &self.scratch,
        )
        .map(|_| ())
    }

    fn restore_as(&self, backup: &Path, name: &str, password: &str) -> Result<PathBuf, VaultError> {
        restore_backup(
            &RestoreOptions {
                backup: backup.to_path_buf(),
                parent_dir: self.tmp.path().join("restored"),
                name: name.into(),
            },
            &pw(password),
            &SystemClock,
        )
    }
}

#[test]
fn backup_verify_restore_round_trip() {
    let mut f = Fixture::new();
    let accounts = count(&f.vault, "account");
    let identities = count(&f.vault, "identity");
    let mfa = count(&f.vault, "mfa_method");
    assert!(accounts > 5 && identities > 0 && mfa > 0);

    let made = create_backup(&f.vault, &f.backups, &SystemClock).unwrap();
    let name = made
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(name.starts_with("Main-") && name.ends_with(".vaultair-backup"));
    assert_eq!(entries(&f.backups), [name], "no temp file is left behind");
    assert_eq!(made.size_bytes, fs::metadata(&made.path).unwrap().len());

    let info = verify_backup(
        &made.path,
        f.vault.keys(),
        &f.vault.info().vault_id,
        &f.scratch,
    )
    .unwrap();
    assert_eq!(info.vault_id, f.vault.info().vault_id);
    assert_eq!(info.created_at, made.created_at);
    assert_eq!(inspect_backup(&made.path).unwrap(), info);
    assert!(
        entries(&f.scratch).is_empty(),
        "the scratch copy is removed"
    );

    // The vault keeps changing after the backup; the backup doesn't.
    f.vault
        .conn_mut()
        .execute("UPDATE account SET title = 'Changed' WHERE id = 'a1'", [])
        .unwrap();
    f.vault
        .conn_mut()
        .execute("DELETE FROM mfa_method", [])
        .unwrap();

    let dir = f.restore_as(&made.path, "Main restored", PASSWORD).unwrap();
    assert_eq!(dir, f.tmp.path().join("restored").join("Main restored"));
    assert!(dir.join(HEADER_FILE).is_file() && dir.join(DB_FILE).is_file());

    let restored = open_vault(&dir, &pw(PASSWORD), None).unwrap();
    assert_eq!(restored.info().vault_id, f.vault.info().vault_id);
    assert_eq!(restored.info().name, "Main restored");
    assert_eq!(count(&restored, "account"), accounts);
    assert_eq!(count(&restored, "identity"), identities);
    assert_eq!(count(&restored, "mfa_method"), mfa);
    assert_eq!(canary_secret(&restored), SECRET_CANARY.as_bytes());
    let title: String = restored
        .conn()
        .query_row("SELECT title FROM account WHERE id = 'a1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title, "Main account");
    assert!(restored.integrity_check().unwrap().ok);

    // The original is untouched and keeps its name.
    assert_eq!(f.vault.info().name, "Main");
    assert_eq!(count(&f.vault, "mfa_method"), 0);
}

#[test]
fn backup_bytes_hold_no_plaintext() {
    let f = Fixture::new();
    let bytes = fs::read(f.backup()).unwrap();
    for canary in [SECRET_CANARY, USER_CANARY, "Main account", "builtin-main"] {
        assert!(!contains(&bytes, canary), "{canary}");
    }
}

#[test]
fn tampered_truncated_or_garbage_files_are_invalid() {
    let f = Fixture::new();
    let good = fs::read(f.backup()).unwrap();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("flipped database byte", {
            let mut b = good.clone();
            let at = b.len() / 2;
            b[at] ^= 0x01;
            b
        }),
        ("flipped MAC byte", {
            let mut b = good.clone();
            let at = b.len() - 1;
            b[at] ^= 0x01;
            b
        }),
        ("truncated", good[..good.len() - 4096].to_vec()),
        ("garbage", b"this is not a backup ".repeat(500)),
        ("empty", Vec::new()),
    ];
    for (i, (name, bytes)) in cases.into_iter().enumerate() {
        let path = f.tmp.path().join(format!("bad-{i}.vaultair-backup"));
        fs::write(&path, bytes).unwrap();
        assert_eq!(f.verify(&path), Err(VaultError::InvalidBackup), "{name}");
        let restored = f.restore_as(&path, &format!("Bad {i}"), PASSWORD);
        assert_eq!(restored, Err(VaultError::InvalidBackup), "{name}");
        assert!(
            !f.tmp
                .path()
                .join("restored")
                .join(format!("Bad {i}"))
                .exists(),
            "{name}: nothing is left behind"
        );
    }
    assert!(entries(&f.scratch).is_empty());
}

#[test]
fn restore_needs_the_backups_password() {
    let f = Fixture::new();
    let backup = f.backup();
    let wrong = f.restore_as(&backup, "Wrong", "orbit lantern cactus mosaiC");
    assert_eq!(wrong, Err(VaultError::WrongPasswordOrTampered));
    assert!(!f.tmp.path().join("restored").join("Wrong").exists());
}

#[test]
fn restore_never_writes_over_a_vault() {
    let f = Fixture::new();
    let backup = f.backup();
    let header_before = fs::read(f.vault.dir().join(HEADER_FILE)).unwrap();

    // Onto the vault it came from.
    let onto_original = restore_backup(
        &RestoreOptions {
            backup: backup.clone(),
            parent_dir: f.tmp.path().to_path_buf(),
            name: "Main".into(),
        },
        &pw(PASSWORD),
        &SystemClock,
    );
    assert_eq!(onto_original, Err(VaultError::AlreadyExists));
    assert_eq!(
        fs::read(f.vault.dir().join(HEADER_FILE)).unwrap(),
        header_before
    );
    assert!(f.vault.integrity_check().unwrap().ok);

    // Onto an earlier restore.
    f.restore_as(&backup, "Copy", PASSWORD).unwrap();
    assert_eq!(
        f.restore_as(&backup, "Copy", PASSWORD),
        Err(VaultError::AlreadyExists)
    );

    assert_eq!(
        f.restore_as(&backup, "a/b", PASSWORD),
        Err(VaultError::InvalidName)
    );
    let relative = restore_backup(
        &RestoreOptions {
            backup,
            parent_dir: PathBuf::from("relative"),
            name: "Copy 2".into(),
        },
        &pw(PASSWORD),
        &SystemClock,
    );
    assert_eq!(relative, Err(VaultError::InvalidLocation));
}

#[test]
fn another_vaults_backup_is_not_verified_with_this_vaults_key() {
    let f = Fixture::new();
    let backup = f.backup();
    let other = new_vault(f.tmp.path(), "Other", false, &SystemClock);
    let result = verify_backup(&backup, other.keys(), &other.info().vault_id, &f.scratch);
    assert_eq!(result.err(), Some(VaultError::BackupOtherVault));
    // Claiming the right vault id with the wrong keys fails the MAC.
    let forged = verify_backup(&backup, other.keys(), &f.vault.info().vault_id, &f.scratch);
    assert_eq!(forged.err(), Some(VaultError::InvalidBackup));
}

#[test]
fn a_missing_or_relative_destination_is_refused() {
    let f = Fixture::new();
    for dir in [f.tmp.path().join("nowhere"), PathBuf::from("relative")] {
        let result = create_backup(&f.vault, &dir, &SystemClock);
        assert_eq!(result.err(), Some(VaultError::BackupDestination));
    }
}

#[test]
fn service_records_the_destination_and_each_result() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let roots = CloudRoots::default();
    let mut vault = new_vault(tmp.path(), "Main", false, &clock);
    let backups = tmp.path().join("backups");
    let scratch = tmp.path().join("scratch");
    fs::create_dir(&backups).unwrap();

    let status = service::status(&vault, &roots, clock.now_utc()).unwrap();
    assert_eq!(status.destination, None);
    assert!(!status.destination_available);
    assert_eq!(status.last_outcome, None);
    assert!(status.reminder_due, "a vault with no backup is reminded");
    assert_eq!(status.reminder_after_days, REMINDER_AFTER_DAYS);

    // No destination yet.
    assert_eq!(
        service::create(&mut vault, &scratch, &clock),
        Err(AppError::InvalidInput {
            field: "destination"
        })
    );

    // Inside the vault, relative, or missing.
    let inside = vault.dir().join("backups");
    fs::create_dir(&inside).unwrap();
    for bad in [inside.clone(), vault.dir().clone(), PathBuf::from("rel")] {
        assert_eq!(
            service::set_destination(&mut vault, Some(&bad), &clock),
            Err(AppError::InvalidInput {
                field: "destination"
            })
        );
    }
    fs::remove_dir(&inside).unwrap();
    assert_eq!(
        service::set_destination(&mut vault, Some(&tmp.path().join("nowhere")), &clock),
        Err(AppError::BackupDestination)
    );

    service::set_destination(&mut vault, Some(&backups), &clock).unwrap();
    let status = service::status(&vault, &roots, clock.now_utc()).unwrap();
    assert_eq!(status.destination, Some(backups.display().to_string()));
    assert!(status.destination_available);
    assert_eq!(status.cloud_provider, None);
    let synced = CloudRoots::new(vec![(backups.clone(), CloudProvider::OneDrive)]);
    assert_eq!(
        service::status(&vault, &synced, clock.now_utc())
            .unwrap()
            .cloud_provider,
        Some(CloudProvider::OneDrive)
    );

    clock.advance(Duration::from_secs(60));
    let made = service::create(&mut vault, &scratch, &clock).unwrap();
    assert_eq!(made.file_name, "Main-19700101-000100.vaultair-backup");
    assert_eq!(made.created_at, "1970-01-01T00:01:00Z");
    assert!(Path::new(&made.path).is_file());
    assert!(entries(&scratch).is_empty());
    assert_eq!(
        service::verify(&vault, Path::new(&made.path), &scratch),
        Ok(made.clone())
    );
    assert_eq!(service::inspect(Path::new(&made.path)), Ok(made.clone()));

    let status = service::status(&vault, &roots, clock.now_utc()).unwrap();
    assert_eq!(status.last_outcome, Some(BackupOutcome::Ok));
    assert_eq!(
        status.last_backup_at.as_deref(),
        Some("1970-01-01T00:01:00Z")
    );
    assert_eq!(status.last_backup_path.as_deref(), Some(made.path.as_str()));
    assert_eq!(
        status.last_attempt_at.as_deref(),
        Some("1970-01-01T00:01:00Z")
    );
    assert!(!status.reminder_due);

    // The reminder comes back at exactly the threshold.
    let day = Duration::from_secs(24 * 60 * 60);
    clock.advance(day * REMINDER_AFTER_DAYS - Duration::from_secs(1));
    assert!(
        !service::status(&vault, &roots, clock.now_utc())
            .unwrap()
            .reminder_due
    );
    clock.advance(Duration::from_secs(1));
    assert!(
        service::status(&vault, &roots, clock.now_utc())
            .unwrap()
            .reminder_due
    );

    // The drive goes away: a clean error, recorded as failed, and the last
    // good backup is still the one on record.
    fs::remove_dir_all(&backups).unwrap();
    assert_eq!(
        service::create(&mut vault, &scratch, &clock),
        Err(AppError::BackupDestination)
    );
    let status = service::status(&vault, &roots, clock.now_utc()).unwrap();
    assert_eq!(status.last_outcome, Some(BackupOutcome::Failed));
    assert_eq!(
        status.last_backup_at.as_deref(),
        Some("1970-01-01T00:01:00Z")
    );
    assert_eq!(
        status.last_attempt_at.as_deref(),
        Some("1970-01-31T00:01:00Z")
    );
    assert!(!status.destination_available);

    service::set_destination(&mut vault, None, &clock).unwrap();
    let status = service::status(&vault, &roots, clock.now_utc()).unwrap();
    assert_eq!(status.destination, None);
}

#[test]
fn a_demo_vault_is_never_reminded() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let vault = new_vault(tmp.path(), "Demo", true, &clock);
    let status = service::status(&vault, &CloudRoots::default(), clock.now_utc()).unwrap();
    assert!(!status.reminder_due);
}

/// The settings a backup records live in the vault, so they are in the next
/// backup and come back with a restore.
#[test]
fn a_restored_vault_remembers_its_backup_settings() {
    let tmp = tempfile::tempdir().unwrap();
    let mut vault = new_vault(tmp.path(), "Main", false, &SystemClock);
    let backups = tmp.path().join("backups");
    let scratch = tmp.path().join("scratch");
    fs::create_dir(&backups).unwrap();
    service::set_destination(&mut vault, Some(&backups), &SystemClock).unwrap();
    service::create(&mut vault, &scratch, &SystemClock).unwrap();
    let second = service::create(&mut vault, &scratch, &SystemClock).unwrap();

    let dir = restore_backup(
        &RestoreOptions {
            backup: PathBuf::from(&second.path),
            parent_dir: tmp.path().join("restored"),
            name: "Main".into(),
        },
        &pw(PASSWORD),
        &SystemClock,
    )
    .unwrap();
    drop(vault);
    let restored = open_vault(&dir, &pw(PASSWORD), None).unwrap();
    let status = service::status(&restored, &CloudRoots::default(), SystemClock.now_utc()).unwrap();
    assert_eq!(status.destination, Some(backups.display().to_string()));
    assert_eq!(status.last_outcome, Some(BackupOutcome::Ok));
}

// ---- Before an upgrade (docs/backup-restore.md) ------------------------------

/// Stands in for the next release's migration, so no real one is needed.
const NEXT_MIGRATION: &str = "CREATE TABLE upgrade_probe (id INTEGER PRIMARY KEY);";

/// `%LOCALAPPDATA%\Vaultair` for these tests.
fn upgrade_backups(tmp: &Path) -> UpgradeBackups {
    UpgradeBackups::in_app_dir(&tmp.join("app"))
}

/// A locked vault at the current schema, with the demo data and the canary
/// account.
fn locked_vault(parent: &Path, demo: bool) -> PathBuf {
    let mut v = new_vault(parent, "Main", demo, &SystemClock);
    vaultair_core::demo::seed(&mut v, &SystemClock).unwrap();
    insert_canary_account(&mut v);
    v.dir().clone()
}

/// Opens `dir` as a build one migration newer would.
fn open_upgrading(dir: &Path, backups: &UpgradeBackups) -> Result<OpenVault, VaultError> {
    open_vault_with_extra_migrations(dir, &pw(PASSWORD), Some(backups), &[NEXT_MIGRATION])
}

fn has_probe_table(v: &OpenVault) -> bool {
    v.conn()
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'upgrade_probe'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
        == 1
}

#[test]
fn an_upgrade_backs_the_vault_up_first() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = locked_vault(tmp.path(), false);
    let backups = upgrade_backups(tmp.path());
    let old_version = migrate::latest_version();
    let accounts = {
        let v = open_vault(&dir, &pw(PASSWORD), Some(&backups)).unwrap();
        assert_eq!(migrate::current_version(v.conn()).unwrap(), old_version);
        count(&v, "account")
    };
    assert!(!backups.dir.exists(), "an up-to-date vault isn't backed up");

    let v = open_upgrading(&dir, &backups).unwrap();
    assert_eq!(migrate::current_version(v.conn()).unwrap(), old_version + 1);
    assert!(has_probe_table(&v));
    let made = entries(&backups.dir);
    assert_eq!(made.len(), 1, "{made:?}");
    assert!(
        made[0].starts_with("Main-") && made[0].ends_with(".vaultair-backup"),
        "{}",
        made[0]
    );
    let backup = backups.dir.join(&made[0]);
    let scratch = tmp.path().join("scratch");
    verify_backup(&backup, v.keys(), &v.info().vault_id, &scratch).unwrap();
    assert!(entries(&backups.scratch_dir).is_empty());

    // Not the user's backup: "Backup due" doesn't change.
    let status = service::status(&v, &CloudRoots::default(), SystemClock.now_utc()).unwrap();
    assert_eq!(status.last_backup_at, None);
    assert_eq!(status.last_outcome, None);
    assert!(status.reminder_due);

    // The same canaries as `backup_bytes_hold_no_plaintext`.
    let bytes = fs::read(&backup).unwrap();
    for canary in [SECRET_CANARY, USER_CANARY, "Main account", "builtin-main"] {
        assert!(!contains(&bytes, canary), "{canary}");
    }
    drop(v);

    // Upgraded now: opening it again makes no second copy.
    drop(open_upgrading(&dir, &backups).unwrap());
    assert_eq!(entries(&backups.dir).len(), 1);

    // The way back: the backup restores to a new folder, at the old schema
    // with the old data, and the build that made it opens it as it is.
    let restored = restore_backup(
        &RestoreOptions {
            backup,
            parent_dir: tmp.path().join("restored"),
            name: "Before upgrade".into(),
        },
        &pw(PASSWORD),
        &SystemClock,
    )
    .unwrap();
    let r = open_vault(&restored, &pw(PASSWORD), None).unwrap();
    assert_eq!(migrate::current_version(r.conn()).unwrap(), old_version);
    assert!(!has_probe_table(&r));
    assert_eq!(count(&r, "account"), accounts);
    assert_eq!(canary_secret(&r), SECRET_CANARY.as_bytes());
}

#[test]
fn a_demo_vault_is_backed_up_before_an_upgrade_too() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = locked_vault(tmp.path(), true);
    let backups = upgrade_backups(tmp.path());
    let v = open_upgrading(&dir, &backups).unwrap();
    assert!(v.info().demo);
    assert_eq!(entries(&backups.dir).len(), 1);
}

#[test]
fn new_and_up_to_date_vaults_are_not_backed_up() {
    let tmp = tempfile::tempdir().unwrap();
    let backups = upgrade_backups(tmp.path());
    let session = SessionManager::new(std::sync::Arc::new(SystemClock), Some(backups.clone()));
    let info = session
        .create(
            &CreateOptions {
                parent_dir: tmp.path().to_path_buf(),
                name: "Main".into(),
                kdf: KdfParams::MINIMUM,
                demo: false,
            },
            &pw(PASSWORD),
        )
        .unwrap();
    assert!(session.lock());
    session
        .unlock(Path::new(&info.path), &pw(PASSWORD))
        .unwrap();
    assert!(session.lock());
    assert!(!backups.dir.exists());
}

#[test]
fn an_unwritable_backup_folder_leaves_the_vault_as_it_was() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = locked_vault(tmp.path(), false);
    let backups = upgrade_backups(tmp.path());
    // A file where the folder should be: nothing can be written into it.
    fs::create_dir_all(backups.dir.parent().unwrap()).unwrap();
    fs::write(&backups.dir, b"not a folder").unwrap();
    let db_before = fs::read(dir.join(DB_FILE)).unwrap();
    let header_before = fs::read(dir.join(HEADER_FILE)).unwrap();

    let err = open_upgrading(&dir, &backups).unwrap_err();
    assert_eq!(
        err,
        VaultError::UpgradeBackup(UpgradeBackupFailure::NotWritable)
    );
    let app = AppError::from(err);
    assert_eq!(app.code(), ErrorCode::UpgradeBackupFailed);
    assert!(app.user_message().contains("safety copy"));
    assert!(app.user_message().contains("can't be written to"));

    assert_eq!(fs::read(dir.join(DB_FILE)).unwrap(), db_before);
    assert_eq!(fs::read(dir.join(HEADER_FILE)).unwrap(), header_before);
    drop(VaultLock::acquire(&dir.join(LOCK_FILE)).expect("the .lock is released"));
    let v = open_vault(&dir, &pw(PASSWORD), None).unwrap();
    assert_eq!(
        migrate::current_version(v.conn()).unwrap(),
        migrate::latest_version()
    );
    assert!(!has_probe_table(&v));
    drop(v);

    // No app-data folder at all: the same, and still nothing changes.
    assert_eq!(
        open_vault_with_extra_migrations(&dir, &pw(PASSWORD), None, &[NEXT_MIGRATION]).err(),
        Some(VaultError::UpgradeBackup(UpgradeBackupFailure::NotWritable))
    );
    assert_eq!(fs::read(dir.join(DB_FILE)).unwrap(), db_before);
}
