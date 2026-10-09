#![allow(clippy::unwrap_used)] // test helpers
//! Golden fixtures (docs/vault-format.md §10): vaults and backups written by
//! released builds, committed under `tests-fixtures/v1/` and opened on every
//! test run, so format and schema changes are always tested against files
//! users really have. Fixtures are append-only: never regenerate or edit one.
//! The password of every fixture is `FIXTURE_PASSWORD`; nothing in them is
//! anyone's real data.

use std::fs;
use std::path::{Path, PathBuf};

use secrecy::SecretString;
use tempfile::TempDir;
use vaultair_core::backup::{create_backup, restore_backup, verify_backup, RestoreOptions};
use vaultair_core::clock::SystemClock;
use vaultair_core::crypto::envelope::{self, FieldRef};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::db::migrate;
use vaultair_core::domain::account::{
    AccountDetail, AccountInput, AccountStatus, AccountType, CustomFieldInput, CustomFieldType,
    PurposeColor, PurposeInput, SecretRef, SecretUpdate,
};
use vaultair_core::domain::catalog::{GameProfileFilter, GameProfileInput};
use vaultair_core::domain::identity::{IdentityColor, IdentityInput};
use vaultair_core::domain::mfa::{MfaInput, MfaMethod};
use vaultair_core::domain::search::SavedViewInput;
use vaultair_core::search::{AccountFilter, AccountSort, SortKey, ViewSpec};
use vaultair_core::service::settings::{self, VaultProfileInput, VaultSettings};
use vaultair_core::service::{accounts, catalog, graph, identities, mfa, purposes, search};
use vaultair_core::vault::layout::{DB_FILE, HEADER_FILE};
use vaultair_core::vault::{create_vault, open_vault, CreateOptions, OpenVault};

const FIXTURE_PASSWORD: &str = "fixture-only password, not a secret";
/// The vault in every fixture folder, and the stem of its backup.
const VAULT_NAME: &str = "Golden";

fn pw(s: &str) -> SecretString {
    SecretString::from(s)
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests-fixtures/v1")
}

/// Copies a committed vault folder's files into `parent/<name>`, so opening
/// it (which migrates and takes `.lock`) never touches the fixture.
fn copy_vault(src: &Path, parent: &Path, name: &str) -> PathBuf {
    assert!(
        src.join(HEADER_FILE).is_file(),
        "missing fixture {}; see generate_golden_fixture",
        src.display()
    );
    let dir = parent.join(name);
    fs::create_dir(&dir).unwrap();
    for f in [HEADER_FILE, DB_FILE] {
        fs::copy(src.join(f), dir.join(f)).unwrap();
    }
    dir
}

// ---- Schema V1 (2026-09-23, before v0.1.0) -----------------------------------

const V1_SECRET_CANARY: &str = "CANARY7F3A-secret";

#[test]
fn golden_fixture_v1_still_opens() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = copy_vault(&fixture_dir().join("Golden"), tmp.path(), "Golden");
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
    assert_eq!(secret.as_slice(), V1_SECRET_CANARY.as_bytes());

    // Migrated to the latest schema: the v1 account is readable through the
    // account service, and the built-in purposes were added around the
    // fixture's own "main" (which keeps its id).
    let listed = accounts::list(&v, &SystemClock, Default::default(), Default::default()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].purpose_id, "p1");
    assert!(listed[0].has_password);
    let purposes = accounts::purposes(&v).unwrap();
    assert_eq!(purposes.len(), 10);
    assert_eq!(purposes.iter().filter(|p| p.slug == "main").count(), 1);
}

// ---- Release fixtures ----------------------------------------------------------
//
// `tests-fixtures/v1/v<version>/` holds `Golden/` (the vault) and
// `Golden.vaultair-backup` (a backup of it), both written by that release's
// own code with `generate_golden_fixture`. Every table in use holds a row, and
// every encrypted column holds a canary.

const PASSWORD_CANARY: &str = "CANARY-password-0f3e";
/// Labelled, so the notes hints flag credentials (`sensitive_notes_hints`).
const NOTES_CANARY: &str = "Password: CANARY-notes-91c2";
const FIELD_CANARY: &str = "CANARY-field-5d7a";
/// Base32, 20 bytes.
const TOTP_CANARY: &str = "CANARYTOTPKEYQQQQQQQQQQQQQQQQQQQ";
const RECOVERY_CANARY: &str = "CANARY-recovery-instructions-2b88";
const CODE_CANARIES: [&str; 3] = ["canary-code-0001", "canary-code-0002", "canary-code-0003"];

const LAUNCHER: &str = "Canary launcher";
const GAME: &str = "Canary game";
const ARCHIVED: &str = "Canary archived";
const IDENTITY: &str = "Canary identity";
const PURPOSE: &str = "Canary purpose";
const VIEW: &str = "Canary view";
const TAG: &str = "canary-tag";
const IDENTITY_TAG: &str = "canary-identity-tag";
const LOGIN_EMAIL: &str = "canary.login@example.invalid";
const RECOVERY_EMAIL: &str = "canary.recovery@example.invalid";
const RECOVERY_PHONE: &str = "Canary phone, ends 42";
const GAMERTAG: &str = "CanaryTag#0001";
const STEAM: &str = "builtin-pl-steam";
const RIOT: &str = "builtin-pl-riot";
const VALORANT: &str = "builtin-game-valorant";

/// Every value differs from `VaultSettings::default()`.
const SETTINGS: VaultSettings = VaultSettings {
    auto_lock_minutes: Some(17),
    lock_on_session_lock: false,
    lock_on_sleep: false,
    lock_on_minimize: true,
    clipboard_clear_secs: 45,
    reveal_hide_secs: 12,
};

fn set(value: &str) -> SecretUpdate {
    SecretUpdate::Set {
        value: value.to_owned(),
    }
}

fn account(title: &str, account_type: AccountType, purpose_id: &str) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type,
        purpose_id: purpose_id.into(),
        status: AccountStatus::Active,
        identity_id: None,
        username: None,
        email: None,
        password: SecretUpdate::Unchanged,
        recovery_email: None,
        recovery_phone: None,
        website_url: None,
        login_url: None,
        platform_id: None,
        game_id: None,
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

/// Writes the release fixture's data through the services, as the app would.
fn populate(v: &mut OpenVault) {
    let c = &SystemClock;
    settings::save(v, &SETTINGS, c).unwrap();
    settings::update_profile(
        v,
        &VaultProfileInput {
            name: VAULT_NAME.into(),
            color: Some(IdentityColor::Rose),
        },
        c,
    )
    .unwrap();

    let identity = identities::create(
        v,
        c,
        &IdentityInput {
            name: IDENTITY.into(),
            description: Some("canary identity description".into()),
            primary_email: Some("canary.identity@example.invalid".into()),
            recovery_email: Some("canary.identity-recovery@example.invalid".into()),
            phone_ref: Some("Canary identity phone, ends 07".into()),
            notes: Some("canary identity notes".into()),
            color: Some(IdentityColor::Teal),
            tags: vec![IDENTITY_TAG.into()],
        },
    )
    .unwrap();
    let purpose = purposes::create(
        v,
        c,
        &PurposeInput {
            name: PURPOSE.into(),
            color: Some(PurposeColor::Amber),
        },
    )
    .unwrap();

    let launcher = accounts::create(
        v,
        c,
        &AccountInput {
            identity_id: Some(identity.id.clone()),
            username: Some("canary-launcher-user".into()),
            email: Some(LOGIN_EMAIL.into()),
            password: set(PASSWORD_CANARY),
            recovery_email: Some(RECOVERY_EMAIL.into()),
            recovery_phone: Some(RECOVERY_PHONE.into()),
            website_url: Some("https://canary.example.com".into()),
            platform_id: Some(STEAM.into()),
            notes: Some("canary plain notes".into()),
            sensitive_notes: set(NOTES_CANARY),
            tags: vec![TAG.into()],
            custom_fields: vec![
                CustomFieldInput {
                    id: None,
                    label: "Canary PIN".into(),
                    field_type: CustomFieldType::Secret,
                    value: None,
                    secret: set(FIELD_CANARY),
                },
                CustomFieldInput {
                    id: None,
                    label: "Canary visible".into(),
                    field_type: CustomFieldType::Text,
                    value: Some("canary-visible-value".into()),
                    secret: SecretUpdate::Unchanged,
                },
            ],
            ..account(LAUNCHER, AccountType::Launcher, &purpose.id)
        },
    )
    .unwrap();
    accounts::set_favorite(v, c, &launcher.id, true).unwrap();
    accounts::mark_verified(v, c, &launcher.id).unwrap();
    let with_mfa = mfa::upsert(
        v,
        c,
        &launcher.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Totp,
            enabled: true,
            totp_secret: set(TOTP_CANARY),
            recovery_instructions: set(RECOVERY_CANARY),
            notes: Some("canary mfa notes".into()),
        },
    )
    .unwrap();
    let method = &with_mfa.mfa[0].id;
    mfa::set_backup_codes(v, c, method, Some(&CODE_CANARIES.join("\n"))).unwrap();
    mfa::mark_code_used(v, c, method, 0, true).unwrap();
    // Copying the password marks the account used (`last_used_at`).
    accounts::reveal(
        v,
        c,
        &SecretRef::AccountPassword {
            id: launcher.id.clone(),
        },
    )
    .unwrap();

    let main = accounts::purposes(v)
        .unwrap()
        .into_iter()
        .find(|p| p.slug == "main")
        .unwrap()
        .id;
    let game = accounts::create(
        v,
        c,
        &AccountInput {
            platform_id: Some(RIOT.into()),
            game_id: Some(VALORANT.into()),
            region: Some("EUW".into()),
            ..account(GAME, AccountType::Game, &main)
        },
    )
    .unwrap();
    catalog::create_profile(
        v,
        c,
        &game.id,
        &GameProfileInput {
            game_id: VALORANT.into(),
            platform_id: Some(RIOT.into()),
            gamertag: Some(GAMERTAG.into()),
            player_id: Some("canary-player-id".into()),
            region: Some("EUW".into()),
            rank_tier: Some("Canary rank".into()),
            current_season: Some("Canary season".into()),
            notes: Some("canary profile notes".into()),
            linked_launcher_account_id: Some(launcher.id.clone()),
            linked_console_account_id: None,
        },
    )
    .unwrap();

    let archived = accounts::create(v, c, &account(ARCHIVED, AccountType::Other, &main)).unwrap();
    accounts::set_archived(v, c, &archived.id, true).unwrap();

    search::create_view(
        v,
        c,
        &SavedViewInput {
            name: VIEW.into(),
            spec: ViewSpec {
                v: 1,
                filter: AccountFilter {
                    tags: vec![TAG.into()],
                    ..Default::default()
                },
                sort: AccountSort {
                    key: SortKey::Updated,
                    descending: true,
                },
            },
        },
    )
    .unwrap();

    let login = contact_id(v, LOGIN_EMAIL);
    graph::set_prospect_dismissed(v, c, &login, true).unwrap();
}

fn contact_id(v: &OpenVault, value: &str) -> String {
    identities::contacts(v)
        .unwrap()
        .into_iter()
        .find(|c| c.value == value)
        .unwrap_or_else(|| panic!("no contact point {value}"))
        .id
}

fn by_title(v: &OpenVault, title: &str, archived: bool) -> AccountDetail {
    let filter = AccountFilter {
        archived,
        ..Default::default()
    };
    let summary = accounts::list(v, &SystemClock, filter, AccountSort::default())
        .unwrap()
        .into_iter()
        .find(|a| a.title == title)
        .unwrap_or_else(|| panic!("no account {title}"));
    accounts::get(v, &summary.id).unwrap()
}

fn reveal(v: &OpenVault, target: SecretRef) -> String {
    accounts::reveal(v, &SystemClock, &target)
        .unwrap()
        .to_string()
}

/// Reads back everything `populate` wrote, through the services wherever
/// they show it. Revealing the password marks the account used again, so
/// `last_used_at` is checked first.
fn assert_release_canaries(v: &OpenVault) {
    assert_eq!(v.info().color, Some(IdentityColor::Rose));
    assert_eq!(settings::load(v.conn()).unwrap(), SETTINGS);

    let launcher = by_title(v, LAUNCHER, false);
    let last_used: Option<String> = v
        .conn()
        .query_row(
            "SELECT last_used_at FROM account WHERE id = ?1",
            [&launcher.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(last_used.as_ref(), Some(&launcher.last_activity_at));
    assert_eq!(launcher.username.as_deref(), Some("canary-launcher-user"));
    assert_eq!(launcher.recovery_email.as_deref(), Some(RECOVERY_EMAIL));
    assert_eq!(launcher.recovery_phone.as_deref(), Some(RECOVERY_PHONE));
    assert_eq!(launcher.identity_name.as_deref(), Some(IDENTITY));
    assert_eq!(launcher.purpose_name, PURPOSE);
    assert_eq!(launcher.platform_id.as_deref(), Some(STEAM));
    assert_eq!(launcher.notes.as_deref(), Some("canary plain notes"));
    assert_eq!(launcher.tags, [TAG]);
    assert!(launcher.favorite);
    assert!(launcher.last_verified_at.is_some());
    assert!(launcher.has_password && launcher.has_sensitive_notes);
    assert!(launcher.notes_suggestions.credentials);

    let [pin, visible] = launcher.custom_fields.as_slice() else {
        panic!("expected two custom fields");
    };
    assert_eq!(
        (
            pin.label.as_str(),
            pin.field_type,
            pin.has_value,
            pin.value.as_deref()
        ),
        ("Canary PIN", CustomFieldType::Secret, true, None)
    );
    assert_eq!(visible.value.as_deref(), Some("canary-visible-value"));

    let [method] = launcher.mfa.as_slice() else {
        panic!("expected one MFA method");
    };
    assert_eq!(method.method, MfaMethod::Totp);
    assert!(method.enabled && method.has_totp && method.has_recovery_instructions);
    assert_eq!(method.notes.as_deref(), Some("canary mfa notes"));
    assert_eq!(
        method
            .backup_codes
            .iter()
            .map(|s| s.used)
            .collect::<Vec<_>>(),
        [true, false, false]
    );
    assert_eq!(method.backup_codes_remaining, 2);

    let id = launcher.id.clone();
    assert_eq!(
        reveal(v, SecretRef::AccountPassword { id: id.clone() }),
        PASSWORD_CANARY
    );
    assert_eq!(reveal(v, SecretRef::SensitiveNotes { id }), NOTES_CANARY);
    assert_eq!(
        reveal(v, SecretRef::CustomField { id: pin.id.clone() }),
        FIELD_CANARY
    );
    assert_eq!(
        reveal(
            v,
            SecretRef::TotpSecret {
                id: method.id.clone()
            }
        ),
        TOTP_CANARY
    );
    assert_eq!(
        reveal(
            v,
            SecretRef::RecoveryInstructions {
                id: method.id.clone()
            }
        ),
        RECOVERY_CANARY
    );
    for (index, code) in (0..).zip(CODE_CANARIES) {
        let target = SecretRef::BackupCode {
            id: method.id.clone(),
            index,
        };
        assert_eq!(reveal(v, target), code);
    }

    let identity = identities::list(v, false)
        .unwrap()
        .into_iter()
        .find(|i| i.name == IDENTITY)
        .unwrap();
    let identity = identities::get(v, &identity.id).unwrap();
    assert_eq!(
        (
            identity.description.as_deref(),
            identity.primary_email.as_deref(),
            identity.recovery_email.as_deref(),
            identity.phone_ref.as_deref(),
            identity.notes.as_deref(),
            identity.color,
        ),
        (
            Some("canary identity description"),
            Some("canary.identity@example.invalid"),
            Some("canary.identity-recovery@example.invalid"),
            Some("Canary identity phone, ends 07"),
            Some("canary identity notes"),
            Some(IdentityColor::Teal),
        )
    );
    assert_eq!(identity.tags, [IDENTITY_TAG]);

    // Contact points: the account's and the identity's. The login email's
    // mailbox suggestion was dismissed, the recovery email's wasn't.
    let mut contacts: Vec<String> = identities::contacts(v)
        .unwrap()
        .into_iter()
        .map(|c| c.value)
        .collect();
    contacts.sort();
    assert_eq!(
        contacts,
        [
            "Canary identity phone, ends 07",
            "Canary phone, ends 42",
            "canary.identity-recovery@example.invalid",
            "canary.identity@example.invalid",
            "canary.login@example.invalid",
            "canary.recovery@example.invalid",
        ]
    );
    let dismissed = |value: &str| -> bool {
        v.conn()
            .query_row(
                "SELECT mailbox_dismissed_at IS NOT NULL FROM contact_point WHERE id = ?1",
                [contact_id(v, value)],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert!(dismissed(LOGIN_EMAIL));
    assert!(!dismissed(RECOVERY_EMAIL));

    let game = by_title(v, GAME, false);
    assert_eq!(
        (game.platform_id.as_deref(), game.game_id.as_deref()),
        (Some(RIOT), Some(VALORANT))
    );
    let profiles = catalog::profiles(
        v,
        &GameProfileFilter {
            account_id: Some(game.id.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    let [profile] = profiles.as_slice() else {
        panic!("expected one game profile");
    };
    assert_eq!(profile.gamertag.as_deref(), Some(GAMERTAG));
    assert_eq!(profile.rank_tier.as_deref(), Some("Canary rank"));
    assert_eq!(
        profile.linked_launcher_account_id.as_deref(),
        Some(launcher.id.as_str())
    );
    assert_eq!(profile.linked_launcher_title.as_deref(), Some(LAUNCHER));

    assert!(by_title(v, ARCHIVED, true).archived_at.is_some());

    let purpose = purposes::list(v)
        .unwrap()
        .into_iter()
        .find(|p| p.name == PURPOSE)
        .unwrap();
    assert!(!purpose.is_builtin);
    assert_eq!(purpose.color, Some(PurposeColor::Amber));
    assert_eq!(purpose.account_count, 1);

    let view = search::views(v)
        .unwrap()
        .into_iter()
        .find(|s| s.name == VIEW)
        .unwrap();
    assert!(!view.is_builtin);
    assert_eq!(view.spec.filter.tags, [TAG]);
    assert_eq!(
        view.spec.sort,
        AccountSort {
            key: SortKey::Updated,
            descending: true
        }
    );
}

/// Writes `tests-fixtures/v1/v<version>/` with the code it's compiled from,
/// and refuses if that folder exists. Run it from a worktree at the release
/// tag (docs/vault-format.md §10), with this file copied in if the tag's
/// copy is older, then move the folder into this repository:
///   cargo test -p vaultair-core --test golden -- --ignored --exact generate_golden_fixture
#[test]
#[ignore = "writes tests-fixtures/v1; run manually at a release tag"]
fn generate_golden_fixture() {
    let dest = fixture_dir().join(concat!("v", env!("CARGO_PKG_VERSION")));
    if let Err(e) = fs::create_dir(&dest) {
        panic!(
            "{} not created ({e}); fixtures are append-only, so an existing one is never rewritten",
            dest.display()
        );
    }
    let dest = dest.canonicalize().unwrap();
    let mut v = create_vault(
        &CreateOptions {
            parent_dir: dest.clone(),
            name: VAULT_NAME.into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &pw(FIXTURE_PASSWORD),
        &SystemClock,
    )
    .unwrap();
    populate(&mut v);
    assert_release_canaries(&v);

    let made = create_backup(&v, &dest, &SystemClock).unwrap();
    let scratch = tempfile::tempdir().unwrap();
    verify_backup(&made.path, v.keys(), &v.info().vault_id, scratch.path()).unwrap();
    fs::rename(
        &made.path,
        dest.join(format!("{VAULT_NAME}.vaultair-backup")),
    )
    .unwrap();
    drop(v);
    fs::remove_file(dest.join(VAULT_NAME).join(".lock")).unwrap();
}

/// The release fixture's files, copied into a temp dir.
struct Release {
    tmp: TempDir,
    vault: PathBuf,
    backup: PathBuf,
}

impl Release {
    fn copy(version: &str) -> Self {
        let src = fixture_dir().join(version);
        let tmp = tempfile::tempdir().unwrap();
        let vault = copy_vault(&src.join(VAULT_NAME), tmp.path(), VAULT_NAME);
        let backup = tmp.path().join(format!("{VAULT_NAME}.vaultair-backup"));
        fs::copy(src.join(format!("{VAULT_NAME}.vaultair-backup")), &backup).unwrap();
        Self { tmp, vault, backup }
    }
}

#[test]
fn release_fixture_v0_1_0_opens_and_migrates() {
    let f = Release::copy("v0.1.0");
    let pristine = f.tmp.path().join("pristine.vdb");
    fs::copy(f.vault.join(DB_FILE), &pristine).unwrap();

    let v = open_vault(&f.vault, &pw(FIXTURE_PASSWORD)).unwrap();
    assert_eq!(v.info().name, VAULT_NAME);
    assert_eq!(
        migrate::current_version(v.conn()).unwrap(),
        migrate::latest_version()
    );
    // The untouched copy, attached with the same key, is still at the schema
    // v0.1.0 shipped.
    v.conn()
        .execute(
            "ATTACH DATABASE ?1 AS pristine",
            [pristine.to_str().unwrap()],
        )
        .unwrap();
    let before: u32 = v
        .conn()
        .query_row("PRAGMA pristine.user_version", [], |r| r.get(0))
        .unwrap();
    v.conn().execute_batch("DETACH DATABASE pristine").unwrap();
    assert_eq!(before, 8);

    assert_release_canaries(&v);
}

#[test]
fn release_backup_v0_1_0_verifies_and_restores() {
    let f = Release::copy("v0.1.0");
    let scratch = f.tmp.path().join("scratch");
    let v = open_vault(&f.vault, &pw(FIXTURE_PASSWORD)).unwrap();
    let info = verify_backup(&f.backup, v.keys(), &v.info().vault_id, &scratch).unwrap();
    assert_eq!(info.vault_id, v.info().vault_id);
    drop(v);

    let restored = restore_backup(
        &RestoreOptions {
            backup: f.backup.clone(),
            parent_dir: f.tmp.path().join("restored"),
            name: "Restored".into(),
        },
        &pw(FIXTURE_PASSWORD),
        &SystemClock,
    )
    .unwrap();
    let v = open_vault(&restored, &pw(FIXTURE_PASSWORD)).unwrap();
    assert_eq!(v.info().name, "Restored");
    assert_eq!(
        migrate::current_version(v.conn()).unwrap(),
        migrate::latest_version()
    );
    assert_release_canaries(&v);
}
