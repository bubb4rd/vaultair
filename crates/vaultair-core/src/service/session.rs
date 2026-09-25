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
use crate::vault::{self, CreateOptions, IntegrityReport, OpenVault, VaultError, VaultInfo};

/// Lock and clipboard behaviour. The defaults are ADR-0004 decision 11.
/// Phase 15 makes them editable: capture protection in the app config (it
/// applies while locked), the rest in the vault's settings.
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
    /// Hide the window from screenshots, streaming and screen sharing.
    pub capture_protection: bool,
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
            capture_protection: true,
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

    fn install(&self, vault: OpenVault) -> VaultInfo {
        let info = vault.info();
        let previous = self.guard().replace(Unlocked {
            vault,
            last_activity: self.clock.monotonic(),
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
        Ok(self.install(vault))
    }

    /// Unlocks the vault in `dir`. Locks any open vault first.
    pub fn unlock(&self, dir: &Path, password: &SecretString) -> Result<VaultInfo, VaultError> {
        self.lock();
        let vault = vault::open_vault(dir, password)?;
        Ok(self.install(vault))
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
    pub fn with_vault<T>(
        &self,
        f: impl FnOnce(&mut OpenVault) -> Result<T, VaultError>,
    ) -> Result<T, VaultError> {
        let mut guard = self.guard();
        let unlocked = guard.as_mut().ok_or(VaultError::Locked)?;
        unlocked.last_activity = self.clock.monotonic();
        f(&mut unlocked.vault)
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
