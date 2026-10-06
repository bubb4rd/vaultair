//! Vault settings: lock and clipboard timings, kept in the vault's own
//! `vault_settings` so they travel with it, and the vault's name and colour
//! (`vault_meta`). Capture protection and email masking are in the app
//! config instead (`crate::config`), because they apply while locked.

use std::ops::RangeInclusive;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::clock::Clock;
use crate::db::repo::settings;
use crate::domain::identity::IdentityColor;
use crate::service::session::SessionConfig;
use crate::vault::layout::validate_name;
use crate::vault::{OpenVault, VaultInfo};
use crate::AppError;

pub const AUTO_LOCK_MINUTES: RangeInclusive<u32> = 1..=120;
/// "Never" is not offered: a copied password must not sit on the clipboard.
pub const CLIPBOARD_CLEAR_SECS: RangeInclusive<u32> = 10..=300;
pub const REVEAL_HIDE_SECS: RangeInclusive<u32> = 5..=300;

const KEY_AUTO_LOCK: &str = "auto_lock_minutes";
const KEY_LOCK_ON_SESSION_LOCK: &str = "lock_on_session_lock";
const KEY_LOCK_ON_SLEEP: &str = "lock_on_sleep";
const KEY_LOCK_ON_MINIMIZE: &str = "lock_on_minimize";
const KEY_CLIPBOARD: &str = "clipboard_clear_seconds";
const KEY_REVEAL: &str = "reveal_hide_seconds";
const NEVER: &str = "never";

/// The lock and clipboard settings the user can change. Sent whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultSettings {
    /// Lock after this many minutes without activity. `None` never locks.
    pub auto_lock_minutes: Option<u32>,
    /// Lock when Windows locks (Win+L), signs out or disconnects.
    pub lock_on_session_lock: bool,
    pub lock_on_sleep: bool,
    pub lock_on_minimize: bool,
    pub clipboard_clear_secs: u32,
    pub reveal_hide_secs: u32,
}

impl Default for VaultSettings {
    /// ADR-0004 decision 11, the same as `SessionConfig::default`.
    fn default() -> Self {
        let c = SessionConfig::default();
        Self {
            auto_lock_minutes: c.idle_lock_secs.map(|s| s / 60),
            lock_on_session_lock: c.lock_on_session_lock,
            lock_on_sleep: c.lock_on_sleep,
            lock_on_minimize: c.lock_on_minimize,
            clipboard_clear_secs: c.clipboard_clear_secs,
            reveal_hide_secs: c.reveal_hide_secs,
        }
    }
}

impl VaultSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if self
            .auto_lock_minutes
            .is_some_and(|m| !AUTO_LOCK_MINUTES.contains(&m))
        {
            return Err(AppError::InvalidInput {
                field: "autoLockMinutes",
            });
        }
        if !CLIPBOARD_CLEAR_SECS.contains(&self.clipboard_clear_secs) {
            return Err(AppError::InvalidInput {
                field: "clipboardClearSecs",
            });
        }
        if !REVEAL_HIDE_SECS.contains(&self.reveal_hide_secs) {
            return Err(AppError::InvalidInput {
                field: "revealHideSecs",
            });
        }
        Ok(())
    }

    /// Copies these into the running session's config.
    pub fn apply_to(&self, config: &mut SessionConfig) {
        config.idle_lock_secs = self.auto_lock_minutes.map(|m| m * 60);
        config.lock_on_session_lock = self.lock_on_session_lock;
        config.lock_on_sleep = self.lock_on_sleep;
        config.lock_on_minimize = self.lock_on_minimize;
        config.clipboard_clear_secs = self.clipboard_clear_secs;
        config.reveal_hide_secs = self.reveal_hide_secs;
    }
}

fn number(value: Option<String>, range: &RangeInclusive<u32>) -> Option<u32> {
    value
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|n| range.contains(n))
}

fn flag(value: Option<String>, default: bool) -> bool {
    match value.as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    }
}

/// The saved settings. A key that was never saved, or holds something this
/// build doesn't accept, reads as its default.
pub fn load(conn: &Connection) -> Result<VaultSettings, AppError> {
    let d = VaultSettings::default();
    let auto_lock = settings::get(conn, KEY_AUTO_LOCK)?;
    Ok(VaultSettings {
        auto_lock_minutes: match auto_lock.as_deref() {
            Some(NEVER) => None,
            _ => number(auto_lock, &AUTO_LOCK_MINUTES).or(d.auto_lock_minutes),
        },
        lock_on_session_lock: flag(
            settings::get(conn, KEY_LOCK_ON_SESSION_LOCK)?,
            d.lock_on_session_lock,
        ),
        lock_on_sleep: flag(settings::get(conn, KEY_LOCK_ON_SLEEP)?, d.lock_on_sleep),
        lock_on_minimize: flag(
            settings::get(conn, KEY_LOCK_ON_MINIMIZE)?,
            d.lock_on_minimize,
        ),
        clipboard_clear_secs: number(settings::get(conn, KEY_CLIPBOARD)?, &CLIPBOARD_CLEAR_SECS)
            .unwrap_or(d.clipboard_clear_secs),
        reveal_hide_secs: number(settings::get(conn, KEY_REVEAL)?, &REVEAL_HIDE_SECS)
            .unwrap_or(d.reveal_hide_secs),
    })
}

/// Validates and saves every setting in one transaction.
pub fn save(
    vault: &mut OpenVault,
    next: &VaultSettings,
    clock: &dyn Clock,
) -> Result<VaultSettings, AppError> {
    next.validate()?;
    let now = clock.now_rfc3339();
    let bool_text = |b: bool| if b { "true" } else { "false" };
    let auto_lock = next
        .auto_lock_minutes
        .map_or_else(|| NEVER.to_owned(), |m| m.to_string());
    let tx = vault.conn_mut().transaction()?;
    settings::set(&tx, KEY_AUTO_LOCK, &auto_lock, &now)?;
    settings::set(
        &tx,
        KEY_LOCK_ON_SESSION_LOCK,
        bool_text(next.lock_on_session_lock),
        &now,
    )?;
    settings::set(&tx, KEY_LOCK_ON_SLEEP, bool_text(next.lock_on_sleep), &now)?;
    settings::set(
        &tx,
        KEY_LOCK_ON_MINIMIZE,
        bool_text(next.lock_on_minimize),
        &now,
    )?;
    settings::set(
        &tx,
        KEY_CLIPBOARD,
        &next.clipboard_clear_secs.to_string(),
        &now,
    )?;
    settings::set(&tx, KEY_REVEAL, &next.reveal_hide_secs.to_string(), &now)?;
    tx.commit()?;
    tracing::info!(
        auto_lock = ?next.auto_lock_minutes,
        clipboard_secs = next.clipboard_clear_secs,
        reveal_secs = next.reveal_hide_secs,
        "vault settings saved"
    );
    Ok(*next)
}

/// The vault's display name and colour, from Settings > General.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultProfileInput {
    /// Same rules as a new vault's name (it names backup files too).
    pub name: String,
    pub color: Option<IdentityColor>,
}

pub fn update_profile(
    vault: &mut OpenVault,
    input: &VaultProfileInput,
    clock: &dyn Clock,
) -> Result<VaultInfo, AppError> {
    if !validate_name(&input.name) {
        return Err(AppError::InvalidInput { field: "name" });
    }
    vault.set_profile(&input.name, input.color, &clock.now_rfc3339())?;
    tracing::info!("vault profile updated");
    Ok(vault.info())
}
