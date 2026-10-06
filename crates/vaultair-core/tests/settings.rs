#![allow(clippy::unwrap_used)] // test helpers
//! Phase 15: vault settings (bounds, persistence, defaults), the vault's
//! name and colour, and changing the master password through the session.

use std::path::Path;
use std::sync::Arc;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::identity::IdentityColor;
use vaultair_core::service::session::{SessionConfig, SessionManager, VaultStatus};
use vaultair_core::service::settings::{self, VaultProfileInput, VaultSettings};
use vaultair_core::vault::{create_vault, open_vault, CreateOptions, OpenVault, VaultError};
use vaultair_core::AppError;

const PASSWORD: &str = "orbit lantern cactus mosaic";
const NEW_PASSWORD: &str = "velvet harbor quartz meadow";

fn options(parent: &Path) -> CreateOptions {
    CreateOptions {
        parent_dir: parent.to_path_buf(),
        name: "Settings".into(),
        kdf: KdfParams::MINIMUM,
        demo: false,
    }
}

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(&options(parent), &SecretString::from(PASSWORD), clock).unwrap()
}

#[test]
fn defaults_match_adr_0004_until_saved() {
    let dir = tempfile::tempdir().unwrap();
    let vault = new_vault(dir.path(), &SystemClock);
    let loaded = settings::load(vault.conn()).unwrap();
    assert_eq!(loaded, VaultSettings::default());

    let mut config = SessionConfig::default();
    loaded.apply_to(&mut config);
    assert_eq!(config, SessionConfig::default());
}

#[test]
fn settings_persist_across_unlocks() {
    let dir = tempfile::tempdir().unwrap();
    let mut vault = new_vault(dir.path(), &SystemClock);
    let next = VaultSettings {
        auto_lock_minutes: None,
        lock_on_session_lock: false,
        lock_on_sleep: false,
        lock_on_minimize: true,
        clipboard_clear_secs: 90,
        reveal_hide_secs: 45,
    };
    settings::save(&mut vault, &next, &SystemClock).unwrap();
    let vault_dir = vault.dir().clone();
    drop(vault);

    let vault = open_vault(&vault_dir, &SecretString::from(PASSWORD)).unwrap();
    assert_eq!(settings::load(vault.conn()).unwrap(), next);

    let mut config = SessionConfig::default();
    next.apply_to(&mut config);
    assert_eq!(config.idle_lock(), None);
    assert_eq!(config.clipboard_clear_secs, 90);
    assert!(config.lock_on_minimize && !config.lock_on_sleep);
}

#[test]
fn out_of_bounds_values_are_refused_and_nothing_is_saved() {
    let dir = tempfile::tempdir().unwrap();
    let mut vault = new_vault(dir.path(), &SystemClock);
    let ok = VaultSettings::default();
    let cases = [
        (
            VaultSettings {
                auto_lock_minutes: Some(0),
                ..ok
            },
            "autoLockMinutes",
        ),
        (
            VaultSettings {
                auto_lock_minutes: Some(121),
                ..ok
            },
            "autoLockMinutes",
        ),
        (
            VaultSettings {
                clipboard_clear_secs: 9,
                ..ok
            },
            "clipboardClearSecs",
        ),
        (
            VaultSettings {
                clipboard_clear_secs: 301,
                ..ok
            },
            "clipboardClearSecs",
        ),
        (
            VaultSettings {
                reveal_hide_secs: 4,
                ..ok
            },
            "revealHideSecs",
        ),
    ];
    for (bad, field) in cases {
        assert_eq!(
            settings::save(&mut vault, &bad, &SystemClock),
            Err(AppError::InvalidInput { field }),
            "{bad:?}"
        );
    }
    // The edges are allowed.
    for edge in [
        VaultSettings {
            auto_lock_minutes: Some(1),
            clipboard_clear_secs: 10,
            reveal_hide_secs: 5,
            ..ok
        },
        VaultSettings {
            auto_lock_minutes: Some(120),
            clipboard_clear_secs: 300,
            reveal_hide_secs: 300,
            ..ok
        },
    ] {
        assert_eq!(settings::save(&mut vault, &edge, &SystemClock), Ok(edge));
    }
}

#[test]
fn garbage_in_the_table_reads_as_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let vault = new_vault(dir.path(), &SystemClock);
    for (key, value) in [
        ("auto_lock_minutes", "9999"),
        ("clipboard_clear_seconds", "0"),
        ("reveal_hide_seconds", "soon"),
        ("lock_on_sleep", "maybe"),
    ] {
        vaultair_core::db::repo::settings::set(vault.conn(), key, value, "2026-10-05T00:00:00Z")
            .unwrap();
    }
    assert_eq!(
        settings::load(vault.conn()).unwrap(),
        VaultSettings::default()
    );
}

#[test]
fn profile_renames_the_vault_but_not_its_folder() {
    let dir = tempfile::tempdir().unwrap();
    let mut vault = new_vault(dir.path(), &SystemClock);
    let folder = vault.dir().clone();
    let info = settings::update_profile(
        &mut vault,
        &VaultProfileInput {
            name: "Tournament (EU)".into(),
            color: Some(IdentityColor::Teal),
        },
        &SystemClock,
    )
    .unwrap();
    assert_eq!(info.name, "Tournament (EU)");
    assert_eq!(info.color, Some(IdentityColor::Teal));
    assert_eq!(info.path, folder.display().to_string());

    for bad in ["", " lead", "a/b", "con"] {
        assert_eq!(
            settings::update_profile(
                &mut vault,
                &VaultProfileInput {
                    name: bad.into(),
                    color: None,
                },
                &SystemClock,
            ),
            Err(AppError::InvalidInput { field: "name" }),
            "{bad}"
        );
    }
    drop(vault);

    assert!(folder.is_dir());
    let reopened = open_vault(&folder, &SecretString::from(PASSWORD)).unwrap();
    assert_eq!(reopened.info().name, "Tournament (EU)");
    assert_eq!(reopened.info().color, Some(IdentityColor::Teal));
}

#[test]
fn change_password_through_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let session = SessionManager::new(Arc::new(SystemClock));
    let info = session
        .create(&options(dir.path()), &SecretString::from(PASSWORD))
        .unwrap();

    assert_eq!(
        session
            .rewrap(
                &SecretString::from("not the password at all"),
                Some(&SecretString::from(NEW_PASSWORD)),
                None,
            )
            .err(),
        Some(VaultError::WrongPasswordOrTampered)
    );

    session
        .rewrap(
            &SecretString::from(PASSWORD),
            Some(&SecretString::from(NEW_PASSWORD)),
            None,
        )
        .unwrap();
    // Still unlocked, and the vault still works.
    assert!(matches!(session.status(), VaultStatus::Unlocked { .. }));
    assert!(session.integrity_check().unwrap().ok);
    assert_eq!(session.kdf_params().unwrap(), KdfParams::MINIMUM);

    session.lock();
    let dir = Path::new(&info.path);
    assert_eq!(
        session.unlock(dir, &SecretString::from(PASSWORD)).err(),
        Some(VaultError::WrongPasswordOrTampered)
    );
    session
        .unlock(dir, &SecretString::from(NEW_PASSWORD))
        .unwrap();
}

#[test]
fn rewrap_needs_an_unlocked_vault() {
    let session = SessionManager::new(Arc::new(SystemClock));
    assert_eq!(
        session
            .rewrap(&SecretString::from(PASSWORD), None, None)
            .err(),
        Some(VaultError::Locked)
    );
}
