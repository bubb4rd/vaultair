#![allow(clippy::unwrap_used)] // test helpers
//! Vault engine integration tests (implementation plan, Phase 3).
//! Every vault here lives in a temp dir and uses test-only passwords.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::params;
use secrecy::SecretString;
use vaultair_core::clock::{Clock, ManualClock, SystemClock};
use vaultair_core::crypto::envelope::{self, FieldRef};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::service::session::{SessionManager, VaultStatus};
use vaultair_core::vault::header::VaultHeader;
use vaultair_core::vault::layout::{DB_FILE, HEADER_FILE};
use vaultair_core::vault::{
    create_vault, open_vault, CorruptPart, CreateOptions, OpenVault, VaultError,
};

const PASSWORD: &str = "orbit lantern cactus mosaic";
const SECRET_CANARY: &str = "CANARY7F3A-secret";
const USER_CANARY: &str = "CANARYUSER-handle";

fn pw(s: &str) -> SecretString {
    SecretString::from(s)
}

fn opts(parent: &Path, name: &str) -> CreateOptions {
    CreateOptions {
        parent_dir: parent.to_path_buf(),
        name: name.into(),
        kdf: KdfParams::MINIMUM,
        demo: false,
    }
}

fn new_vault(parent: &Path) -> (OpenVault, PathBuf) {
    let v = create_vault(&opts(parent, "Test Vault"), &pw(PASSWORD), &SystemClock).unwrap();
    let dir = v.dir().clone();
    (v, dir)
}

fn now() -> &'static str {
    "2026-09-23T00:00:00Z"
}

/// Inserts one account whose password is a field envelope and whose username is plaintext (in SQLCipher).
fn insert_canary_account(v: &mut OpenVault) {
    let field_key = *v.keys().field_key();
    let conn = v.conn_mut();
    conn.execute(
        "INSERT INTO purpose_label (id, slug, name, is_builtin, created_at, updated_at) VALUES ('p1','main','Main',1,?1,?1)",
        params![now()],
    )
    .unwrap();
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
    conn.execute(
        "INSERT INTO account (id, title, account_type, purpose_id, username, password_enc, created_at, updated_at)
         VALUES ('a1', 'Main account', 'game', 'p1', ?1, ?2, ?3, ?3)",
        params![USER_CANARY, blob, now()],
    )
    .unwrap();
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    let n = needle.as_bytes();
    let utf16: Vec<u8> = needle.encode_utf16().flat_map(u16::to_le_bytes).collect();
    haystack.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
        || haystack.windows(utf16.len()).any(|w| w == utf16)
}

#[test]
fn create_lock_unlock_persists_data() {
    let tmp = tempfile::tempdir().unwrap();
    let (mut v, dir) = new_vault(tmp.path());
    assert_eq!(v.info().name, "Test Vault");
    assert_eq!(v.info().kdf_summary, "Argon2id 64 MiB, t=3, p=4");
    insert_canary_account(&mut v);
    let id = v.info().vault_id;
    drop(v); // lock: connection closed, keys wiped, .lock released

    let v = open_vault(&dir, &pw(PASSWORD)).unwrap();
    assert_eq!(v.info().vault_id, id);
    let user: String = v
        .conn()
        .query_row("SELECT username FROM account WHERE id='a1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(user, USER_CANARY);

    let blob: Vec<u8> = v
        .conn()
        .query_row("SELECT password_enc FROM account WHERE id='a1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let secret = envelope::open(
        v.keys().field_key(),
        FieldRef {
            table: "account",
            column: "password_enc",
            row_id: "a1",
        },
        &blob,
    )
    .unwrap();
    assert_eq!(secret.as_slice(), SECRET_CANARY.as_bytes());
    assert!(v.integrity_check().unwrap().ok);
}

#[test]
fn wrong_password_fails_only_after_running_argon2() {
    let tmp = tempfile::tempdir().unwrap();
    let (v, dir) = new_vault(tmp.path());
    drop(v);

    let t = Instant::now();
    open_vault(&dir, &pw(PASSWORD)).unwrap();
    let good = t.elapsed();

    let t = Instant::now();
    let err = open_vault(&dir, &pw("orbit lantern cactus mosaiC")).unwrap_err();
    let bad = t.elapsed();

    assert_eq!(err, VaultError::WrongPasswordOrTampered);
    // No early exit: a wrong password costs a full Argon2 run.
    assert!(
        bad.as_secs_f64() >= good.as_secs_f64() * 0.4,
        "wrong={bad:?} right={good:?}"
    );
}

fn tamper(dir: &Path, f: impl FnOnce(&mut VaultHeader)) {
    let path = dir.join(HEADER_FILE);
    let mut h = VaultHeader::decode(&fs::read(&path).unwrap()).unwrap();
    f(&mut h);
    // encode() recomputes the CRC, as an attacker would.
    fs::write(&path, h.encode()).unwrap();
}

#[test]
fn authenticated_header_fields_cannot_be_changed() {
    type Mutation = fn(&mut VaultHeader);
    let cases: Vec<(&str, Mutation)> = vec![
        ("salt", |h| {
            h.kdf.salt_b64 = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=".into()
        }),
        ("m (still valid)", |h| h.kdf.m_kib += 8 * 1024),
        ("t", |h| h.kdf.t += 1),
        ("p", |h| h.kdf.p = 2),
        ("vault_id", |h| {
            h.vault_id = uuid::Uuid::now_v7().to_string()
        }),
        ("created_at", |h| {
            h.created_at = "2020-01-01T00:00:00Z".into()
        }),
        ("demo flag", |h| h.demo = true),
        ("nonce", |h| {
            let s = &mut h.key_slots[0].wrap.nonce_b64;
            *s = if s.starts_with('A') {
                s.replacen('A', "B", 1)
            } else {
                format!("A{}", &s[1..])
            };
        }),
        ("ciphertext", |h| {
            let s = &mut h.key_slots[0].wrap.ct_b64;
            *s = if s.starts_with('A') {
                s.replacen('A', "B", 1)
            } else {
                format!("A{}", &s[1..])
            };
        }),
    ];
    for (name, mutate) in cases {
        let tmp = tempfile::tempdir().unwrap();
        let (v, dir) = new_vault(tmp.path());
        drop(v);
        tamper(&dir, mutate);
        assert_eq!(
            open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
            VaultError::WrongPasswordOrTampered,
            "{name}"
        );
    }
}

#[test]
fn damaged_or_foreign_headers_are_classified() {
    let tmp = tempfile::tempdir().unwrap();
    let (v, dir) = new_vault(tmp.path());
    drop(v);
    let path = dir.join(HEADER_FILE);
    let original = fs::read(&path).unwrap();
    let corrupt = VaultError::Corrupted(CorruptPart::Header);

    let mut raw_cases: Vec<(&str, Vec<u8>)> = vec![
        ("truncated", original[..original.len() / 2].to_vec()),
        ("empty", vec![]),
        (
            "bad magic",
            [b"NOTVAULT".as_slice(), &original[8..]].concat(),
        ),
    ];
    let mut crc = original.clone();
    let n = crc.len() - 1;
    crc[n] ^= 0x55;
    raw_cases.push(("bad crc", crc));
    for (name, bytes) in raw_cases {
        fs::write(&path, &bytes).unwrap();
        assert_eq!(
            open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
            corrupt,
            "{name}"
        );
    }

    fs::write(&path, &original).unwrap();
    tamper(&dir, |h| h.kdf.m_kib = 1024);
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        corrupt,
        "KDF below floor"
    );

    fs::write(&path, &original).unwrap();
    tamper(&dir, |h| h.kdf.m_kib = 4 * 1024 * 1024);
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        corrupt,
        "KDF above cap"
    );

    fs::write(&path, &original).unwrap();
    tamper(&dir, |h| {
        h.format_version = 2;
        h.min_reader_version = 2;
    });
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::TooNew
    );

    fs::write(&path, &original).unwrap();
    assert!(
        open_vault(&dir, &pw(PASSWORD)).is_ok(),
        "restoring the header restores access"
    );
}

#[test]
fn flipped_database_bytes_are_detected() {
    let tmp = tempfile::tempdir().unwrap();
    let (mut v, dir) = new_vault(tmp.path());
    insert_canary_account(&mut v);
    drop(v);
    let db = dir.join(DB_FILE);
    let mut bytes = fs::read(&db).unwrap();
    assert!(bytes.len() >= 4096 * 4, "expected a multi-page database");
    bytes[4096 * 2 + 200] ^= 0xFF; // inside page 3
    fs::write(&db, &bytes).unwrap();
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::Corrupted(CorruptPart::Database)
    );
}

#[test]
fn swapped_database_from_another_vault_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let (a, dir_a) = new_vault(tmp.path());
    let b = create_vault(&opts(tmp.path(), "Other"), &pw(PASSWORD), &SystemClock).unwrap();
    let dir_b = b.dir().clone();
    drop((a, b));
    fs::copy(dir_b.join(DB_FILE), dir_a.join(DB_FILE)).unwrap();
    // Different DEK, so the key doesn't open the foreign database.
    assert_eq!(
        open_vault(&dir_a, &pw(PASSWORD)).unwrap_err(),
        VaultError::Corrupted(CorruptPart::Database)
    );
}

#[test]
fn missing_pieces_are_distinct() {
    let tmp = tempfile::tempdir().unwrap();
    assert_eq!(
        open_vault(&tmp.path().join("nope"), &pw(PASSWORD)).unwrap_err(),
        VaultError::NotFound
    );
    assert_eq!(
        open_vault(Path::new("relative/dir"), &pw(PASSWORD)).unwrap_err(),
        VaultError::InvalidLocation
    );

    let (v, dir) = new_vault(tmp.path());
    drop(v);
    let db = dir.join(DB_FILE);
    let moved = tmp.path().join("db.bak");
    fs::rename(&db, &moved).unwrap();
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::DatabaseMissing
    );
    fs::rename(&moved, &db).unwrap();

    fs::remove_file(dir.join(HEADER_FILE)).unwrap();
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::HeaderMissing
    );
}

#[test]
fn a_vault_can_only_be_open_once() {
    let tmp = tempfile::tempdir().unwrap();
    let (v, dir) = new_vault(tmp.path());
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::InUse
    );
    drop(v);
    let again = open_vault(&dir, &pw(PASSWORD)).unwrap();
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::InUse
    );
    drop(again);
}

#[test]
fn no_plaintext_on_disk_and_secrets_survive_only_as_envelopes() {
    let tmp = tempfile::tempdir().unwrap();
    let (mut v, dir) = new_vault(tmp.path());
    insert_canary_account(&mut v);

    // Plaintext export of the whole DB: usernames appear (sanity check that
    // the export works), secrets do not (the field layer holds).
    let export = tmp.path().join("export-plain.db");
    v.conn()
        .execute_batch(&format!(
            "ATTACH DATABASE '{}' AS plain KEY ''; SELECT sqlcipher_export('plain'); DETACH DATABASE plain;",
            export.display()
        ))
        .unwrap();
    drop(v);

    let exported = fs::read(&export).unwrap();
    assert!(
        exported.starts_with(b"SQLite format 3"),
        "export should be plaintext SQLite"
    );
    assert!(contains(&exported, USER_CANARY), "export sanity check");
    assert!(
        !contains(&exported, SECRET_CANARY),
        "secret visible in plaintext export"
    );

    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let bytes = fs::read(&path).unwrap();
        for canary in [
            SECRET_CANARY,
            USER_CANARY,
            "CANARY",
            "Main account",
            "Test Vault",
        ] {
            assert!(
                !contains(&bytes, canary),
                "{canary} found in {}",
                path.display()
            );
        }
    }
    let db = fs::read(dir.join(DB_FILE)).unwrap();
    assert!(
        !db.starts_with(b"SQLite format 3"),
        "database file is not encrypted"
    );
}

#[test]
fn creation_is_validated() {
    let tmp = tempfile::tempdir().unwrap();
    let weak = create_vault(&opts(tmp.path(), "A"), &pw("password1234"), &SystemClock).unwrap_err();
    assert!(matches!(weak, VaultError::WeakPassword(_)));
    let short = create_vault(&opts(tmp.path(), "A"), &pw("Xy7!q"), &SystemClock).unwrap_err();
    assert!(matches!(short, VaultError::WeakPassword(_)));

    assert_eq!(
        create_vault(&opts(tmp.path(), "../escape"), &pw(PASSWORD), &SystemClock).unwrap_err(),
        VaultError::InvalidName
    );
    assert_eq!(
        create_vault(
            &opts(Path::new("relative"), "A"),
            &pw(PASSWORD),
            &SystemClock
        )
        .unwrap_err(),
        VaultError::InvalidLocation
    );
    let weak_kdf = CreateOptions {
        kdf: KdfParams {
            m_kib: 1024,
            ..KdfParams::MINIMUM
        },
        ..opts(tmp.path(), "A")
    };
    assert!(matches!(
        create_vault(&weak_kdf, &pw(PASSWORD), &SystemClock),
        Err(VaultError::Crypto(_))
    ));

    let occupied = tmp.path().join("Busy");
    fs::create_dir(&occupied).unwrap();
    fs::write(occupied.join("keep.txt"), "user file").unwrap();
    assert_eq!(
        create_vault(&opts(tmp.path(), "Busy"), &pw(PASSWORD), &SystemClock).unwrap_err(),
        VaultError::AlreadyExists
    );
    assert_eq!(
        fs::read_to_string(occupied.join("keep.txt")).unwrap(),
        "user file",
        "never touch user files"
    );

    // Failed creations leave nothing behind.
    assert!(!tmp.path().join("A").exists());
}

#[test]
fn schema_is_migrated_and_future_schemas_are_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let (v, dir) = new_vault(tmp.path());
    let version: i64 = v
        .conn()
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 1);
    v.conn().pragma_update(None, "user_version", 99).unwrap();
    drop(v);
    assert_eq!(
        open_vault(&dir, &pw(PASSWORD)).unwrap_err(),
        VaultError::TooNew
    );
}

#[test]
fn session_manager_state_machine() {
    let tmp = tempfile::tempdir().unwrap();
    let session = SessionManager::default();
    assert_eq!(session.status(), VaultStatus::Locked);
    assert_eq!(session.integrity_check().unwrap_err(), VaultError::Locked);

    let info = session
        .create(&opts(tmp.path(), "Session"), &pw(PASSWORD))
        .unwrap();
    assert!(
        matches!(session.status(), VaultStatus::Unlocked { ref vault } if vault.vault_id == info.vault_id)
    );
    assert!(session.integrity_check().unwrap().ok);
    assert!(session.last_activity().is_some());

    assert!(session.lock());
    assert!(!session.lock());
    assert_eq!(session.status(), VaultStatus::Locked);

    let dir = PathBuf::from(&info.path);
    assert_eq!(
        session
            .unlock(&dir, &pw("wrong wrong wrong wrong"))
            .unwrap_err(),
        VaultError::WrongPasswordOrTampered
    );
    assert_eq!(session.status(), VaultStatus::Locked);
    session.unlock(&dir, &pw(PASSWORD)).unwrap();
    // Unlocking again (same vault) first locks, so it isn't "in use" by ourselves.
    session.unlock(&dir, &pw(PASSWORD)).unwrap();
    assert!(session.lock());
}

#[test]
fn idle_lock_fires_at_the_deadline_and_touch_extends_it() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = Arc::new(ManualClock::default());
    let session = SessionManager::new(clock.clone());
    session.set_idle_lock(Some(Duration::from_secs(300)));
    // Nothing to lock, and touching a locked session does nothing.
    assert!(!session.lock_if_idle());
    assert!(!session.touch());
    assert_eq!(session.idle_deadline(), None);

    session
        .create(&opts(tmp.path(), "Idle"), &pw(PASSWORD))
        .unwrap();
    let opened = clock.monotonic();
    assert_eq!(
        session.idle_deadline(),
        Some(opened + Duration::from_secs(300))
    );

    // Activity at 4 min pushes the deadline to 9 min.
    clock.advance(Duration::from_secs(240));
    assert!(!session.lock_if_idle());
    assert!(session.touch());
    clock.advance(Duration::from_secs(299));
    assert!(!session.lock_if_idle());
    assert!(matches!(session.status(), VaultStatus::Unlocked { .. }));

    // Exactly at the deadline it locks, and data commands are refused.
    clock.advance(Duration::from_secs(1));
    assert!(session.lock_if_idle());
    assert_eq!(session.status(), VaultStatus::Locked);
    assert_eq!(session.integrity_check().unwrap_err(), VaultError::Locked);
    assert!(!session.lock_if_idle());
}

#[test]
fn idle_lock_can_be_turned_off() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = Arc::new(ManualClock::default());
    let session = SessionManager::new(clock.clone());
    session
        .create(&opts(tmp.path(), "Never"), &pw(PASSWORD))
        .unwrap();
    session.set_idle_lock(None);
    assert_eq!(session.idle_deadline(), None);
    clock.advance(Duration::from_secs(24 * 60 * 60));
    assert!(!session.lock_if_idle());
    assert!(matches!(session.status(), VaultStatus::Unlocked { .. }));

    // Turning it back on applies to the time already idle.
    session.set_idle_lock(Some(Duration::from_secs(60)));
    assert!(session.lock_if_idle());
}

// Golden fixture: a v1 vault committed to the repo, so future format or
// schema changes are tested against a real old vault. Regenerate (only
// before the first public release) with:
//   cargo test -p vaultair-core --test vault_integration -- --ignored generate_golden_fixture
const FIXTURE_PASSWORD: &str = "fixture-only password, not a secret";

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests-fixtures/v1")
}

#[test]
#[ignore = "writes tests-fixtures/v1; run manually"]
fn generate_golden_fixture() {
    let parent = fixture_dir();
    let dir = parent.join("Golden");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&parent).unwrap();
    let parent = parent.canonicalize().unwrap();
    let mut v = create_vault(
        &opts(&parent, "Golden"),
        &pw(FIXTURE_PASSWORD),
        &SystemClock,
    )
    .unwrap();
    insert_canary_account(&mut v);
    drop(v);
    fs::remove_file(dir.join(".lock")).unwrap();
}

#[test]
fn golden_fixture_v1_still_opens() {
    let src = fixture_dir().join("Golden");
    assert!(
        src.join(HEADER_FILE).is_file(),
        "missing fixture; see generate_golden_fixture"
    );
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("Golden");
    fs::create_dir(&dir).unwrap();
    for f in [HEADER_FILE, DB_FILE] {
        fs::copy(src.join(f), dir.join(f)).unwrap();
    }
    let v = open_vault(&dir, &pw(FIXTURE_PASSWORD)).unwrap();
    assert_eq!(v.info().name, "Golden");
    let blob: Vec<u8> = v
        .conn()
        .query_row("SELECT password_enc FROM account WHERE id='a1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let secret = envelope::open(
        v.keys().field_key(),
        FieldRef {
            table: "account",
            column: "password_enc",
            row_id: "a1",
        },
        &blob,
    )
    .unwrap();
    assert_eq!(secret.as_slice(), SECRET_CANARY.as_bytes());
}

/// Acceptance: unlock at calibrated parameters takes <= 1.5 s. Timing-based,
/// so run on demand in release mode:
///   cargo test --release -p vaultair-core --test vault_integration -- --ignored unlock_time
#[test]
#[ignore = "timing; run in release mode on demand"]
#[allow(clippy::disallowed_macros, clippy::print_stderr)] // report the measurement
fn unlock_time_at_calibrated_params() {
    let params =
        vaultair_core::crypto::kdf::calibrate(vaultair_core::crypto::kdf::CALIBRATE_TARGET)
            .unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let options = CreateOptions {
        kdf: params,
        ..opts(tmp.path(), "Timing")
    };
    let dir = create_vault(&options, &pw(PASSWORD), &SystemClock)
        .unwrap()
        .dir()
        .clone();
    let t = Instant::now();
    let _v = open_vault(&dir, &pw(PASSWORD)).unwrap();
    let elapsed = t.elapsed();
    eprintln!("unlock took {elapsed:?} at {}", params.summary());
    assert!(
        elapsed.as_secs_f64() <= 1.5,
        "unlock took {elapsed:?} at {}",
        params.summary()
    );
}
