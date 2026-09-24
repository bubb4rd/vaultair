//! The lock/unlock state machine. One vault is open at a time (ADR-0004).
//!
//! Slow work (Argon2, SQLCipher open) happens *outside* the mutex, so status
//! checks never wait on an unlock. Locking drops the `OpenVault`, which
//! closes the database, zeroizes keys and releases the `.lock` file.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use secrecy::SecretString;
use serde::Serialize;

use crate::clock::{Clock, SystemClock};
use crate::vault::{self, CreateOptions, IntegrityReport, OpenVault, VaultError, VaultInfo};

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

impl SessionManager {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            state: Mutex::new(None),
            clock,
        }
    }

    fn guard(&self) -> MutexGuard<'_, Option<Unlocked>> {
        // A panic while holding the lock can't leave a half-updated Option,
        // so recovering from poisoning is safe.
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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

    /// Time of the last vault activity, for idle auto-lock (Phase 5).
    pub fn last_activity(&self) -> Option<Instant> {
        self.guard().as_ref().map(|u| u.last_activity)
    }
}
