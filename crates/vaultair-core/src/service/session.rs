//! The lock/unlock state machine. One vault is open at a time (ADR-0004).
//!
//! Slow work (Argon2, SQLCipher open) happens *outside* the mutex, so status
//! checks never wait on an unlock. Locking drops the `OpenVault`, which
//! closes the database, zeroizes keys and releases the `.lock` file.
//!
//! Rust owns the inactivity deadline: the UI reports activity
//! (`session_touch`), and a timer in the app layer calls `lock_if_idle`.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use secrecy::SecretString;
use serde::Serialize;

use crate::clock::{Clock, SystemClock};
use crate::config::{CaptureLevel, CaptureMode};
use crate::crypto::kdf::KdfParams;
use crate::crypto::keys::VaultKeys;
use crate::vault::device_slot::Binding;
use crate::vault::{self, CreateOptions, IntegrityReport, OpenVault, VaultError, VaultInfo};

/// Lock and clipboard behaviour. The defaults are ADR-0004 decision 11.
/// Capture protection and email masking come from the app config (they
/// apply while locked); the rest from the open vault's settings
/// (`service::settings`), applied on unlock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    /// Lock after this many seconds without activity. `None` never locks.
    pub idle_lock_secs: Option<u32>,
    /// Lock when Windows locks (Win+L), signs out or disconnects.
    pub lock_on_session_lock: bool,
    pub lock_on_sleep: bool,
    pub lock_on_minimize: bool,
    /// Copied values are cleared from the clipboard after this long.
    pub clipboard_clear_secs: u32,
    /// Revealed secrets hide again after this long.
    pub reveal_hide_secs: u32,
    /// Mask email and recovery email on an account until the user shows them.
    pub hide_emails: bool,
    /// Saved policy: always on, off, or custom per account rating.
    pub capture_mode: CaptureMode,
    /// Rating at or below which Custom mode hides the window.
    pub capture_level: CaptureLevel,
    /// Whether the window is hidden from capture right now.
    pub capture_protection: bool,
    /// Closing the window hides Vaultair to the tray (and locks) instead
    /// of quitting.
    pub keep_in_tray: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            idle_lock_secs: Some(5 * 60),
            lock_on_session_lock: true,
            lock_on_sleep: true,
            lock_on_minimize: false,
            clipboard_clear_secs: 30,
            reveal_hide_secs: 20,
            hide_emails: false,
            capture_mode: CaptureMode::Always,
            capture_level: CaptureLevel::Risk,
            capture_protection: true,
            keep_in_tray: false,
        }
    }
}

impl SessionConfig {
    pub fn idle_lock(&self) -> Option<Duration> {
        self.idle_lock_secs.map(|s| Duration::from_secs(s.into()))
    }

    pub fn clipboard_clear(&self) -> Duration {
        Duration::from_secs(self.clipboard_clear_secs.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum VaultStatus {
    Locked,
    Unlocked { vault: VaultInfo },
}

#[derive(Debug)]
struct Unlocked {
    vault: OpenVault,
    last_activity: Instant,
    /// When the master password opened this session. `None` after a quick
    /// unlock, which proves no password.
    password_at: Option<Instant>,
}

pub struct SessionManager {
    state: Mutex<Option<Unlocked>>,
    idle_lock: Mutex<Option<Duration>>,
    clock: Arc<dyn Clock>,
}

impl std::fmt::Debug for SessionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionManager").finish_non_exhaustive()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new(Arc::new(SystemClock))
    }
}

/// Recovers from poisoning: a panic while holding either lock can't leave a
/// half-updated value (each is replaced whole).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl SessionManager {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            state: Mutex::new(None),
            idle_lock: Mutex::new(SessionConfig::default().idle_lock()),
            clock,
        }
    }

    fn guard(&self) -> MutexGuard<'_, Option<Unlocked>> {
        lock(&self.state)
    }

    fn install(&self, vault: OpenVault, with_password: bool) -> VaultInfo {
        let info = vault.info();
        let now = self.clock.monotonic();
        let previous = self.guard().replace(Unlocked {
            vault,
            last_activity: now,
            password_at: with_password.then_some(now),
        });
        drop(previous);
        info
    }

    /// Creates a vault and leaves it unlocked. Locks any open vault first.
    pub fn create(
        &self,
        opts: &CreateOptions,
        password: &SecretString,
    ) -> Result<VaultInfo, VaultError> {
        self.lock();
        let vault = vault::create_vault(opts, password, self.clock.as_ref())?;
        Ok(self.install(vault, true))
    }

    /// Unlocks the vault in `dir`. Locks any open vault first.
    pub fn unlock(&self, dir: &Path, password: &SecretString) -> Result<VaultInfo, VaultError> {
        self.lock();
        let vault = vault::open_vault(dir, password)?;
        Ok(self.install(vault, true))
    }

    /// Returns true if a vault was open.
    pub fn lock(&self) -> bool {
        let taken = self.guard().take();
        let was_open = taken.is_some();
        drop(taken);
        if was_open {
            tracing::info!("vault locked");
        }
        was_open
    }

    pub fn status(&self) -> VaultStatus {
        match self.guard().as_ref() {
            Some(u) => VaultStatus::Unlocked {
                vault: u.vault.info(),
            },
            None => VaultStatus::Locked,
        }
    }

    /// Runs `f` against the unlocked vault and records activity.
    /// Commands hold the lock for the whole call, so a lock (idle, Win+L)
    /// waits for an in-flight write to finish rather than cutting it off.
    pub fn with_vault<T, E: From<VaultError>>(
        &self,
        f: impl FnOnce(&mut OpenVault) -> Result<T, E>,
    ) -> Result<T, E> {
        let mut guard = self.guard();
        let unlocked = guard.as_mut().ok_or(VaultError::Locked)?;
        unlocked.last_activity = self.clock.monotonic();
        f(&mut unlocked.vault)
    }

    /// Wraps the vault key again: under a new master password (`new`), with
    /// new KDF parameters (`kdf`), or both. Argon2 runs outside the lock;
    /// only the header write holds it.
    pub fn rewrap(
        &self,
        current: &SecretString,
        new: Option<&SecretString>,
        kdf: Option<KdfParams>,
    ) -> Result<VaultInfo, VaultError> {
        let header = self.with_vault(|v| Ok::<_, VaultError>(v.header().clone()))?;
        let kdf = kdf.unwrap_or_else(|| header.kdf_params());
        let next = vault::prepare_rewrap(&header, current, new, kdf)?;
        let now = self.clock.now_rfc3339();
        self.with_vault(|v| {
            vault::install_header(v, &header, next, &now)?;
            Ok(v.info())
        })
    }

    /// Unlocks the vault in `dir` with keys a device slot gave back
    /// (`service::quick_unlock`). Locks any open vault first.
    pub fn unlock_quick(
        &self,
        dir: &Path,
        keys: VaultKeys,
        binding: &Binding,
    ) -> Result<VaultInfo, VaultError> {
        self.lock();
        let vault = vault::open_vault_with_keys(dir, keys, binding)?;
        Ok(self.install(vault, false))
    }

    /// How long ago the master password opened this session. `None` while
    /// locked, or when Windows Hello opened it.
    pub fn password_age(&self) -> Option<Duration> {
        let at = self.guard().as_ref()?.password_at?;
        Some(self.clock.monotonic().saturating_duration_since(at))
    }

    /// Checks `password` against the open vault. Argon2 runs outside the lock.
    pub fn verify_password(&self, password: &SecretString) -> Result<(), VaultError> {
        let header = self.with_vault(|v| Ok::<_, VaultError>(v.header().clone()))?;
        vault::unwrap_dek(&header, password).map(drop)
    }

    /// The vault's current KDF parameters.
    pub fn kdf_params(&self) -> Result<KdfParams, VaultError> {
        self.with_vault(|v| Ok(v.header().kdf_params()))
    }

    pub fn integrity_check(&self) -> Result<IntegrityReport, VaultError> {
        self.with_vault(|v| v.integrity_check())
    }

    /// Time of the last vault activity.
    pub fn last_activity(&self) -> Option<Instant> {
        self.guard().as_ref().map(|u| u.last_activity)
    }

    /// Records user activity (pointer or keyboard in the UI), pushing the
    /// idle deadline back. Returns false if the vault is locked.
    pub fn touch(&self) -> bool {
        let now = self.clock.monotonic();
        self.guard()
            .as_mut()
            .map(|u| u.last_activity = now)
            .is_some()
    }

    /// `None` turns idle locking off.
    pub fn set_idle_lock(&self, after: Option<Duration>) {
        *lock(&self.idle_lock) = after;
    }

    /// When the vault will lock if nothing else happens. `None` while
    /// locked or with idle locking off.
    pub fn idle_deadline(&self) -> Option<Instant> {
        let after = (*lock(&self.idle_lock))?;
        self.last_activity().map(|last| last + after)
    }

    /// Locks if the idle deadline has passed. Returns true if it locked.
    pub fn lock_if_idle(&self) -> bool {
        let Some(after) = *lock(&self.idle_lock) else {
            return false;
        };
        let now = self.clock.monotonic();
        let taken = {
            let mut guard = self.guard();
            let idle = guard
                .as_ref()
                .is_some_and(|u| now.saturating_duration_since(u.last_activity) >= after);
            if idle {
                guard.take()
            } else {
                None
            }
        };
        let locked = taken.is_some();
        drop(taken);
        if locked {
            tracing::info!("vault locked after inactivity");
        }
        locked
    }
}
