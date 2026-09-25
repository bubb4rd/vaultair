#![allow(clippy::unwrap_used)] // test helpers
//! Account, secret and MFA services end to end against real (temp-dir)
//! vaults (implementation plan, Phase 7), including the security canary
//! suite: secrets never reach DTOs, logs, the search index or a plaintext
//! export of the database.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, ManualClock, SystemClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::crypto::totp;
use vaultair_core::domain::account::{
    AccountInput, AccountStatus, AccountType, AccountUrl, CustomFieldInput, CustomFieldType,
    SecretRef, SecretUpdate,
};
use vaultair_core::domain::mfa::{MfaInput, MfaMethod, TotpAlgorithm};
use vaultair_core::service::{accounts, mfa};
use vaultair_core::vault::layout::DB_FILE;
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const PASSWORD: &str = "orbit lantern cactus mosaic";
const SECRET: &str = "CANARY7F3A";
const USER: &str = "CANARYUSER";
/// RFC 6238's SHA-1 test key ("12345678901234567890") in base32.
const TOTP_KEY: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Accounts".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from(PASSWORD),
        clock,
    )
    .unwrap()
}

fn set(value: &str) -> SecretUpdate {
    SecretUpdate::Set {
        value: value.into(),
    }
}

fn input(title: &str) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type: AccountType::Launcher,
        purpose_id: "builtin-main".into(),
        status: AccountStatus::Active,
        username: None,
        email: None,
        password: SecretUpdate::Unchanged,
        website_url: None,
        login_url: None,
        publisher: None,
        region: None,
        player_id: None,
        display_name: None,
        notes: None,
        sensitive_notes: SecretUpdate::Unchanged,
        tags: Vec::new(),
        custom_fields: Vec::new(),
    }
}

fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
    r.err().and_then(|e| e.field())
}

fn password_blob(v: &OpenVault, id: &str) -> Option<Vec<u8>> {
    v.conn()
        .query_row(
            "SELECT password_enc FROM account WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn create_read_update_with_tri_state_secrets() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);

    let mut form = AccountInput {
        username: Some("  nightowl ".into()),
        email: Some("nightowl@example.com".into()),
        password: set("correct horse battery staple 42"),
        login_url: Some("store.example.com/login".into()),
        notes: Some("Main library".into()),
        sensitive_notes: set("Recovery answer: blue"),
        tags: vec!["pc".into(), "PC".into(), "ranked".into()],
        custom_fields: vec![
            CustomFieldInput {
                id: None,
                label: "PIN".into(),
                field_type: CustomFieldType::Secret,
                value: None,
                secret: set("4821"),
            },
            CustomFieldInput {
                id: None,
                label: "Created".into(),
                field_type: CustomFieldType::Date,
                value: Some("2016-03-12".into()),
                secret: SecretUpdate::Unchanged,
            },
        ],
        ..input("Game store")
    };
    let created = accounts::create(&mut v, &clock, &form).unwrap();
    assert_eq!(created.username.as_deref(), Some("nightowl"));
    assert_eq!(
        created.login_url.as_deref(),
        Some("https://store.example.com/login")
    );
    assert!(created.has_password && created.has_sensitive_notes);
    assert!(created.password_strength.is_some());
    let first_change = created.password_changed_at.clone().unwrap();
    assert_eq!(created.tags, ["pc", "ranked"]);
    assert_eq!(created.purpose_name, "Main");
    let pin = &created.custom_fields[0];
    assert_eq!((pin.value.as_deref(), pin.has_value), (None, true));
    assert_eq!(
        created.custom_fields[1].value.as_deref(),
        Some("2016-03-12")
    );

    let reveal = |v: &OpenVault, r: SecretRef| accounts::reveal(v, &clock, &r).unwrap().to_string();
    assert_eq!(
        reveal(
            &v,
            SecretRef::AccountPassword {
                id: created.id.clone()
            }
        ),
        "correct horse battery staple 42"
    );
    assert_eq!(
        reveal(
            &v,
            SecretRef::SensitiveNotes {
                id: created.id.clone()
            }
        ),
        "Recovery answer: blue"
    );
    assert_eq!(
        reveal(&v, SecretRef::CustomField { id: pin.id.clone() }),
        "4821"
    );

    // Unchanged never touches the stored envelopes.
    let blob = password_blob(&v, &created.id);
    clock.advance(Duration::from_secs(60));
    form.title = "Game store (main)".into();
    form.password = SecretUpdate::Unchanged;
    form.sensitive_notes = SecretUpdate::Unchanged;
    form.custom_fields[0].id = Some(pin.id.clone());
    form.custom_fields[0].secret = SecretUpdate::Unchanged;
    form.custom_fields[1].id = Some(created.custom_fields[1].id.clone());
    let updated = accounts::update(&mut v, &clock, &created.id, &form).unwrap();
    assert_eq!(updated.title, "Game store (main)");
    assert_eq!(password_blob(&v, &created.id), blob);
    assert_eq!(
        updated.password_changed_at.as_deref(),
        Some(first_change.as_str())
    );
    assert_eq!(
        reveal(&v, SecretRef::CustomField { id: pin.id.clone() }),
        "4821"
    );
    assert!(updated.has_sensitive_notes);
    assert_ne!(updated.updated_at, created.updated_at);

    // Setting the same value again isn't a password change.
    clock.advance(Duration::from_secs(60));
    form.password = set("correct horse battery staple 42");
    let same = accounts::update(&mut v, &clock, &created.id, &form).unwrap();
    assert_eq!(
        same.password_changed_at.as_deref(),
        Some(first_change.as_str())
    );

    // A new value is.
    form.password = set("a whole new password 77");
    let changed = accounts::update(&mut v, &clock, &created.id, &form).unwrap();
    assert_ne!(
        changed.password_changed_at.as_deref(),
        Some(first_change.as_str())
    );
    assert_ne!(password_blob(&v, &created.id), blob);

    // Clear removes the secret and what's derived from it.
    form.password = SecretUpdate::Clear;
    form.sensitive_notes = SecretUpdate::Clear;
    form.custom_fields.remove(0);
    let cleared = accounts::update(&mut v, &clock, &created.id, &form).unwrap();
    assert!(!cleared.has_password && !cleared.has_sensitive_notes);
    assert_eq!(cleared.password_strength, None);
    assert_eq!(cleared.custom_fields.len(), 1);
    assert_eq!(
        accounts::reveal(
            &v,
            &clock,
            &SecretRef::AccountPassword {
                id: created.id.clone()
            }
        )
        .err(),
        Some(AppError::NotFound)
    );
    assert_eq!(
        accounts::reveal(&v, &clock, &SecretRef::CustomField { id: pin.id.clone() }).err(),
        Some(AppError::NotFound)
    );
}

#[test]
fn required_fields_and_urls_are_validated() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path(), &SystemClock);

    assert_eq!(
        field_of(accounts::create(&mut v, &SystemClock, &input("  "))),
        Some("title")
    );
    let no_purpose = AccountInput {
        purpose_id: "nope".into(),
        ..input("x")
    };
    assert_eq!(
        field_of(accounts::create(&mut v, &SystemClock, &no_purpose)),
        Some("purposeId")
    );
    for url in ["javascript:alert(1)", "file:///C:/x", "ms-settings:privacy"] {
        let bad = AccountInput {
            login_url: Some(url.into()),
            ..input("x")
        };
        assert_eq!(
            field_of(accounts::create(&mut v, &SystemClock, &bad)),
            Some("loginUrl"),
            "{url}"
        );
    }
    let bad_email = AccountInput {
        email: Some("not-an-email".into()),
        ..input("x")
    };
    assert_eq!(
        field_of(accounts::create(&mut v, &SystemClock, &bad_email)),
        Some("email")
    );
    let empty_password = AccountInput {
        password: set(""),
        ..input("x")
    };
    assert_eq!(
        field_of(accounts::create(&mut v, &SystemClock, &empty_password)),
        Some("password")
    );
    let bad_date = AccountInput {
        custom_fields: vec![CustomFieldInput {
            id: None,
            label: "Created".into(),
            field_type: CustomFieldType::Date,
            value: Some("2023-02-30".into()),
            secret: SecretUpdate::Unchanged,
        }],
        ..input("x")
    };
    assert_eq!(
        field_of(accounts::create(&mut v, &SystemClock, &bad_date)),
        Some("customFields")
    );
    // Nothing half-made was left behind by any rejection.
    assert!(accounts::list(&v, false).unwrap().is_empty());

    // An id from another account can't be smuggled into a custom field list.
    let a = accounts::create(
        &mut v,
        &SystemClock,
        &AccountInput {
            custom_fields: vec![CustomFieldInput {
                id: None,
                label: "PIN".into(),
                field_type: CustomFieldType::Secret,
                value: None,
                secret: set("1111"),
            }],
            ..input("A")
        },
    )
    .unwrap();
    let b = accounts::create(&mut v, &SystemClock, &input("B")).unwrap();
    let steal = AccountInput {
        custom_fields: vec![CustomFieldInput {
            id: Some(a.custom_fields[0].id.clone()),
            label: "PIN".into(),
            field_type: CustomFieldType::Secret,
            value: None,
            secret: SecretUpdate::Unchanged,
        }],
        ..input("B")
    };
    assert_eq!(
        field_of(accounts::update(&mut v, &SystemClock, &b.id, &steal)),
        Some("customFields")
    );
}

#[test]
fn archive_favorite_verify_and_open_url() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let a = accounts::create(
        &mut v,
        &clock,
        &AccountInput {
            website_url: Some("https://Store.Example.com/".into()),
            ..input("A")
        },
    )
    .unwrap();

    let archived = accounts::set_archived(&mut v, &clock, &a.id, true).unwrap();
    assert!(archived.archived_at.is_some());
    assert!(accounts::list(&v, false).unwrap().is_empty());
    assert_eq!(accounts::list(&v, true).unwrap().len(), 1);
    accounts::set_archived(&mut v, &clock, &a.id, false).unwrap();
    assert_eq!(accounts::list(&v, false).unwrap().len(), 1);

    let starred = accounts::set_favorite(&mut v, &clock, &a.id, true).unwrap();
    assert!(starred.favorite);
    let summary = &accounts::list(&v, false).unwrap()[0];
    assert!(summary.favorite && summary.favorited_at.is_some());
    assert!(
        !accounts::set_favorite(&mut v, &clock, &a.id, false)
            .unwrap()
            .favorite
    );

    assert!(a.last_verified_at.is_none());
    clock.advance(Duration::from_secs(5));
    let verified = accounts::mark_verified(&mut v, &clock, &a.id).unwrap();
    assert!(verified.last_verified_at.is_some());

    let target = accounts::url_target(&v, &a.id, AccountUrl::Website).unwrap();
    assert_eq!(target.url, "https://Store.Example.com/");
    assert_eq!(target.host, "store.example.com");
    assert_eq!(
        accounts::url_target(&v, &a.id, AccountUrl::Login).err(),
        Some(AppError::NotFound)
    );
    // A URL that no longer passes validation isn't opened, even if stored.
    v.conn()
        .execute(
            "UPDATE account SET login_url = 'javascript:alert(1)' WHERE id = ?1",
            [&a.id],
        )
        .unwrap();
    assert!(accounts::url_target(&v, &a.id, AccountUrl::Login).is_err());
}

fn count(v: &OpenVault, sql: &str, id: &str) -> i64 {
    v.conn().query_row(sql, [id], |r| r.get(0)).unwrap()
}

#[test]
fn delete_needs_the_title_and_cascades() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let a = accounts::create(
        &mut v,
        &clock,
        &AccountInput {
            tags: vec!["solo-tag".into()],
            custom_fields: vec![CustomFieldInput {
                id: None,
                label: "Note".into(),
                field_type: CustomFieldType::Text,
                value: Some("x".into()),
                secret: SecretUpdate::Unchanged,
            }],
            ..input("Delete me")
        },
    )
    .unwrap();
    mfa::upsert(
        &mut v,
        &clock,
        &a.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Totp,
            enabled: true,
            totp_secret: set(TOTP_KEY),
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();

    assert_eq!(
        field_of(accounts::delete(&mut v, &a.id, "delete me")),
        Some("confirmTitle")
    );
    assert_eq!(
        field_of(accounts::delete(&mut v, &a.id, "")),
        Some("confirmTitle")
    );
    assert_eq!(accounts::list(&v, false).unwrap().len(), 1);

    accounts::delete(&mut v, &a.id, " Delete me ").unwrap();
    assert!(accounts::list(&v, false).unwrap().is_empty());
    for sql in [
        "SELECT count(*) FROM account_custom_field WHERE account_id = ?1",
        "SELECT count(*) FROM account_tag WHERE account_id = ?1",
        "SELECT count(*) FROM mfa_method WHERE account_id = ?1",
        "SELECT count(*) FROM search_index WHERE entity_id = ?1",
    ] {
        assert_eq!(count(&v, sql, &a.id), 0, "{sql}");
    }
    assert!(
        accounts::tags(&v).unwrap().is_empty(),
        "unused tags are pruned"
    );
    assert_eq!(accounts::get(&v, &a.id).err(), Some(AppError::NotFound));
    assert_eq!(
        accounts::delete(&mut v, &a.id, "Delete me").err(),
        Some(AppError::NotFound)
    );
}

#[test]
fn duplicate_as_template_carries_no_secrets() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let src = accounts::create(
        &mut v,
        &clock,
        &AccountInput {
            username: Some("owl".into()),
            email: Some("owl@example.com".into()),
            password: set(SECRET),
            website_url: Some("https://arena.example.com".into()),
            publisher: Some("Example Publisher".into()),
            region: Some("EUW".into()),
            player_id: Some("Owl#EUW".into()),
            display_name: Some("Owl".into()),
            notes: Some("main notes".into()),
            sensitive_notes: set(SECRET),
            tags: vec!["ranked".into()],
            custom_fields: vec![
                CustomFieldInput {
                    id: None,
                    label: "PIN".into(),
                    field_type: CustomFieldType::Secret,
                    value: None,
                    secret: set(SECRET),
                },
                CustomFieldInput {
                    id: None,
                    label: "Server".into(),
                    field_type: CustomFieldType::Text,
                    value: Some("EU West".into()),
                    secret: SecretUpdate::Unchanged,
                },
            ],
            ..input("Arena main")
        },
    )
    .unwrap();
    mfa::upsert(
        &mut v,
        &clock,
        &src.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Totp,
            enabled: true,
            totp_secret: set(TOTP_KEY),
            recovery_instructions: set(SECRET),
            notes: None,
        },
    )
    .unwrap();

    let dup = accounts::duplicate_as_template(&mut v, &clock, &src.id).unwrap();
    assert_ne!(dup.id, src.id);
    assert_eq!(dup.title, "Arena main (alt)");
    assert_eq!(dup.purpose_id, "builtin-alt");
    assert_eq!(dup.publisher.as_deref(), Some("Example Publisher"));
    assert_eq!(dup.region.as_deref(), Some("EUW"));
    assert_eq!(dup.website_url, src.website_url);
    assert_eq!(dup.tags, ["ranked"]);
    assert_eq!(
        dup.custom_fields
            .iter()
            .map(|f| f.label.as_str())
            .collect::<Vec<_>>(),
        ["PIN", "Server"]
    );
    assert!(dup
        .custom_fields
        .iter()
        .all(|f| !f.has_value && f.value.is_none()));
    assert_eq!(dup.username, None);
    assert_eq!(dup.email, None);
    assert_eq!(dup.player_id, None);
    assert_eq!(dup.display_name, None);
    assert_eq!(dup.notes, None);
    assert!(!dup.has_password && !dup.has_sensitive_notes);
    assert!(dup.mfa.is_empty());
    assert!(!dup.favorite && dup.last_verified_at.is_none());

    let secret_columns: i64 = v
        .conn()
        .query_row(
            "SELECT (password_enc IS NOT NULL) + (password_fp IS NOT NULL) + (sensitive_notes_enc IS NOT NULL)
             FROM account WHERE id = ?1",
            [&dup.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(secret_columns, 0);
}

#[test]
fn mfa_totp_backup_codes_and_recovery() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let a = accounts::create(&mut v, &clock, &input("A")).unwrap();

    let bad = MfaInput {
        id: None,
        method: MfaMethod::Totp,
        enabled: true,
        totp_secret: set("definitely not base32!"),
        recovery_instructions: SecretUpdate::Unchanged,
        notes: None,
    };
    assert_eq!(
        field_of(mfa::upsert(&mut v, &clock, &a.id, &bad)),
        Some("totpSecret")
    );

    let d = mfa::upsert(
        &mut v,
        &clock,
        &a.id,
        &MfaInput {
            totp_secret: set("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"),
            recovery_instructions: set("Call support with the order number"),
            ..bad
        },
    )
    .unwrap();
    let m = &d.mfa[0];
    assert!(m.has_totp && m.has_recovery_instructions);
    assert_eq!((m.totp_digits, m.totp_period), (Some(6), Some(30)));
    let summary = &accounts::list(&v, false).unwrap()[0];
    assert!(summary.mfa_enabled);

    // The ManualClock starts at the Unix epoch; advance to an RFC 6238 time.
    clock.advance(Duration::from_secs(59));
    let code = mfa::totp_code(&v, &clock, &m.id).unwrap();
    let expected = totp::code(b"12345678901234567890", TotpAlgorithm::Sha1, 6, 30, 59);
    assert_eq!(code.code, expected.as_str());
    assert_eq!(code.seconds_remaining, 1);
    let secret = accounts::reveal(&v, &clock, &SecretRef::TotpSecret { id: m.id.clone() }).unwrap();
    assert_eq!(secret.as_str(), TOTP_KEY);

    let d = mfa::set_backup_codes(
        &mut v,
        &clock,
        &m.id,
        Some("1. aaaa-1111\n2. bbbb-2222\n3. cccc-3333"),
    )
    .unwrap();
    assert_eq!(d.mfa[0].backup_codes.len(), 3);
    assert_eq!(d.mfa[0].backup_codes_remaining, 3);
    let d = mfa::mark_code_used(&mut v, &clock, &m.id, 1, true).unwrap();
    assert_eq!(d.mfa[0].backup_codes_remaining, 2);
    assert!(d.mfa[0].backup_codes[1].used);
    assert_eq!(
        accounts::list(&v, false).unwrap()[0].backup_codes_remaining,
        2
    );
    let second = accounts::reveal(
        &v,
        &clock,
        &SecretRef::BackupCode {
            id: m.id.clone(),
            index: 1,
        },
    )
    .unwrap();
    assert_eq!(second.as_str(), "bbbb-2222");
    assert_eq!(
        mfa::mark_code_used(&mut v, &clock, &m.id, 9, true).err(),
        Some(AppError::NotFound)
    );

    // Disabling MFA drops it from the list flags.
    let d = mfa::upsert(
        &mut v,
        &clock,
        &a.id,
        &MfaInput {
            id: Some(m.id.clone()),
            method: MfaMethod::Totp,
            enabled: false,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: Some("Moved to a hardware key".into()),
        },
    )
    .unwrap();
    assert!(d.mfa[0].has_totp, "unchanged keeps the key");
    assert!(!accounts::list(&v, false).unwrap()[0].mfa_enabled);

    let cleared = mfa::set_backup_codes(&mut v, &clock, &m.id, None).unwrap();
    assert!(cleared.mfa[0].backup_codes.is_empty());
    let gone = mfa::delete(&mut v, &clock, &m.id).unwrap();
    assert!(gone.mfa.is_empty());
}

// ---- Security canary suite --------------------------------------------------

/// Collects every log line written while it's the default subscriber.
#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

/// Installs a global subscriber that records every log line from every test
/// in this binary (a scoped one races with the other tests' callsite
/// registration). The canary test then checks all of it, which only makes
/// the check stricter: no test here may log a secret either.
fn capture_logs() -> Captured {
    static CAPTURED: std::sync::OnceLock<Captured> = std::sync::OnceLock::new();
    CAPTURED
        .get_or_init(|| {
            let captured = Captured::default();
            let writer = captured.clone();
            let subscriber = tracing_subscriber::fmt()
                .with_writer(move || writer.clone())
                .with_ansi(false)
                .with_max_level(tracing::Level::TRACE)
                .finish();
            tracing::subscriber::set_global_default(subscriber).unwrap();
            captured
        })
        .clone()
}

impl Write for Captured {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    let n = needle.as_bytes();
    let utf16: Vec<u8> = needle.encode_utf16().flat_map(u16::to_le_bytes).collect();
    haystack.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
        || haystack.windows(utf16.len()).any(|w| w == utf16)
}

#[test]
fn canary_secrets_never_leave_through_dtos_logs_index_or_export() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let captured = capture_logs();
    let mut dtos: Vec<String> = Vec::new();
    let totp_key;
    let mut v = {
        let mut v = new_vault(tmp.path(), &clock);
        let mut form = AccountInput {
            username: Some(format!("{USER}-handle")),
            email: Some(format!("{}@example.com", USER.to_lowercase())),
            password: set(&format!("{SECRET}-password")),
            sensitive_notes: set(&format!("{SECRET}-notes")),
            custom_fields: vec![CustomFieldInput {
                id: None,
                label: "PIN".into(),
                field_type: CustomFieldType::Secret,
                value: None,
                secret: set(&format!("{SECRET}-field")),
            }],
            tags: vec!["canary".into()],
            website_url: Some("https://example.com".into()),
            ..input("Canary account")
        };
        let a = accounts::create(&mut v, &clock, &form).unwrap();
        form.custom_fields[0].id = Some(a.custom_fields[0].id.clone());
        form.password = set(&format!("{SECRET}-password-2"));
        form.custom_fields[0].secret = SecretUpdate::Unchanged;
        let updated = accounts::update(&mut v, &clock, &a.id, &form).unwrap();
        let with_mfa = mfa::upsert(
            &mut v,
            &clock,
            &a.id,
            &MfaInput {
                id: None,
                method: MfaMethod::AuthenticatorApp,
                enabled: true,
                totp_secret: set(TOTP_KEY),
                recovery_instructions: set(&format!("{SECRET}-recovery")),
                notes: None,
            },
        )
        .unwrap();
        let m = with_mfa.mfa[0].id.clone();
        let codes = format!("{SECRET}-code-1\n{SECRET}-code-2");
        let coded = mfa::set_backup_codes(&mut v, &clock, &m, Some(&codes)).unwrap();
        let marked = mfa::mark_code_used(&mut v, &clock, &m, 0, true).unwrap();
        // Reveal everything once, as the UI would (these calls are logged too).
        for r in [
            SecretRef::AccountPassword { id: a.id.clone() },
            SecretRef::SensitiveNotes { id: a.id.clone() },
            SecretRef::CustomField {
                id: a.custom_fields[0].id.clone(),
            },
            SecretRef::RecoveryInstructions { id: m.clone() },
            SecretRef::BackupCode {
                id: m.clone(),
                index: 1,
            },
            SecretRef::TotpCode { id: m.clone() },
        ] {
            accounts::reveal(&v, &clock, &r).unwrap();
        }
        totp_key = accounts::reveal(&v, &clock, &SecretRef::TotpSecret { id: m.clone() })
            .unwrap()
            .to_string();
        let dup = accounts::duplicate_as_template(&mut v, &clock, &a.id).unwrap();
        let archived = accounts::set_archived(&mut v, &clock, &dup.id, true).unwrap();

        // Every non-reveal response the UI could receive.
        for json in [
            serde_json::to_string(&a),
            serde_json::to_string(&updated),
            serde_json::to_string(&with_mfa),
            serde_json::to_string(&coded),
            serde_json::to_string(&marked),
            serde_json::to_string(&dup),
            serde_json::to_string(&archived),
            serde_json::to_string(&accounts::get(&v, &a.id).unwrap()),
            serde_json::to_string(&accounts::list(&v, false).unwrap()),
            serde_json::to_string(&accounts::list(&v, true).unwrap()),
            serde_json::to_string(&accounts::tags(&v).unwrap()),
            serde_json::to_string(&accounts::purposes(&v).unwrap()),
            serde_json::to_string(&accounts::url_target(&v, &a.id, AccountUrl::Website).unwrap()),
        ] {
            dtos.push(json.unwrap());
        }
        accounts::delete(&mut v, &dup.id, &dup.title).unwrap();
        v
    };
    assert_eq!(totp_key, TOTP_KEY);

    for json in &dtos {
        assert!(!json.contains(SECRET), "secret in a DTO: {json}");
        assert!(!json.contains(TOTP_KEY), "TOTP key in a DTO: {json}");
    }
    assert!(
        dtos.iter().any(|j| j.contains(USER)),
        "sanity: usernames are in DTOs"
    );

    let logs = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    assert!(
        logs.contains("account created"),
        "sanity: logs were captured: {logs:?}"
    );
    for canary in [
        SECRET,
        USER,
        &USER.to_lowercase(),
        TOTP_KEY,
        "Canary account",
    ] {
        assert!(!logs.contains(canary), "{canary} in logs:\n{logs}");
    }

    let index: Vec<String> = {
        let mut stmt = v
            .conn()
            .prepare(
                "SELECT title || username || email || tags || notes || player_id FROM search_index",
            )
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert!(!index.is_empty());
    for row in &index {
        assert!(!row.contains(SECRET), "secret in the search index: {row}");
    }
    assert!(
        index.iter().any(|r| r.contains(USER)),
        "sanity: usernames are indexed"
    );

    // A plaintext export of the whole database still holds only envelopes.
    let export = tmp.path().join("plain.db");
    v.conn_mut()
        .execute_batch(&format!(
            "ATTACH DATABASE '{}' AS plain KEY ''; SELECT sqlcipher_export('plain'); DETACH DATABASE plain;",
            export.display()
        ))
        .unwrap();
    let dir = v.dir().clone();
    drop(v);
    let exported = fs::read(&export).unwrap();
    assert!(contains(&exported, USER), "sanity: the export is plaintext");
    assert!(!contains(&exported, SECRET), "secret in a plaintext export");
    assert!(
        !contains(&exported, TOTP_KEY),
        "TOTP key in a plaintext export"
    );

    // And the encrypted files hold nothing readable at all.
    let db = fs::read(dir.join(DB_FILE)).unwrap();
    for canary in [SECRET, USER, TOTP_KEY, "Canary account"] {
        assert!(!contains(&db, canary), "{canary} in the vault file");
    }
}

#[test]
fn demo_seed_is_browsable_and_uses_example_domains() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    vaultair_core::demo::seed(&mut v, &clock).unwrap();

    let active = accounts::list(&v, false).unwrap();
    let archived = accounts::list(&v, true).unwrap();
    assert_eq!(active.len(), 8);
    assert_eq!(archived.len(), 1);
    assert!(active.iter().all(|a| a.has_password));
    assert_eq!(active.iter().filter(|a| a.favorite).count(), 3);
    assert!(active
        .iter()
        .any(|a| a.mfa_enabled && a.backup_codes_remaining > 0));
    assert!(
        active.iter().any(|a| a.password_strength.unwrap_or(4) <= 1),
        "a weak one to show"
    );
    for a in active.iter().chain(&archived) {
        let d = accounts::get(&v, &a.id).unwrap();
        for value in [d.email, d.website_url, d.login_url].into_iter().flatten() {
            assert!(
                value.contains("example.com") || value.contains(".invalid"),
                "{value} is not a reserved example domain"
            );
        }
    }
}
