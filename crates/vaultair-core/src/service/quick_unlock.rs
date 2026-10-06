//! Quick unlock with Windows Hello (ADR-0005): the rules, and the steps that
//! turn it on, use it and turn it off. The slot format is in
//! `vault::device_slot`; Hello, DPAPI and the uptime come in through
//! [`QuickUnlockDevice`], which the app implements over `vaultair-platform`.
//!
//! The master password stays the root of trust. It is asked for:
//!
//! - to turn quick unlock on, and to turn it off;
//! - for the first unlock after Windows restarts;
//! - more than 7 days after it was last typed for this vault on this PC;
//! - after 3 Hello attempts in a row that failed or were cancelled;
//! - after the password or the KDF changes (the slot no longer matches);
//! - whenever Hello or its key is gone.
//!
//! Errors carry no dynamic data, and any Hello failure falls back to the
//! password.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use secrecy::SecretString;
use serde::Serialize;
use zeroize::Zeroizing;

use crate::clock::Clock;
use crate::crypto::keys::VaultKeys;
use crate::service::session::SessionManager;
use crate::vault::atomic_write::write_atomic;
use crate::vault::device_slot::{
    header_binding, slot_path, Binding, DeviceSlot, PolicyRecord, CHALLENGE_LEN,
};
use crate::vault::header::VaultHeader;
use crate::vault::{self, VaultError, VaultInfo};
use crate::AppError;

/// The folder under `%LOCALAPPDATA%\Vaultair` that holds the slots.
pub const DEVICES_DIR: &str = "devices";
/// The password is asked for again this long after it was last typed.
pub const MAX_PASSWORD_AGE_SECS: i64 = 7 * 24 * 60 * 60;
/// Hello attempts in a row that may fail or be cancelled.
pub const MAX_FAILURES: u8 = 3;
/// The start of the Windows session is worked out as now minus the uptime,
/// so two readings of the same session differ a little.
pub const BOOT_TOLERANCE_SECS: i64 = 120;

/// The name of a vault's Hello key. Hello rejects `/` in names.
pub fn key_name(vault_id: &str) -> String {
    format!("Vaultair-{vault_id}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum HelloState {
    Available,
    /// This PC can do Hello, but no PIN, fingerprint or face is set up.
    NotSetUp,
    Unsupported,
}

/// Why the master password is needed this time, though quick unlock is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum PasswordReason {
    Restarted,
    Expired,
    TooManyAttempts,
    HelloUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QuickUnlockStatus {
    pub hello: HelloState,
    /// This PC has a TPM for Hello to keep its keys in. Without one the
    /// keys are protected by software only, and the UI says so.
    pub hardware_backed: bool,
    /// Quick unlock is on for this vault on this PC.
    pub enabled: bool,
    /// Set when it is on but this unlock needs the password anyway.
    pub password_required: Option<PasswordReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceError {
    /// The user closed the Hello prompt or chose not to approve.
    Cancelled,
    /// Hello has no key by that name (Hello was reset or removed).
    KeyMissing,
    Failed,
}

/// What quick unlock needs from Windows.
pub trait QuickUnlockDevice: Send + Sync {
    fn hello(&self) -> HelloState;
    fn has_tpm(&self) -> bool;
    /// Creates the key, replacing one of the same name. Shows a Hello prompt.
    fn enroll(&self, key_name: &str) -> Result<(), DeviceError>;
    /// Signs `challenge` with the key. The same challenge always gives the
    /// same signature. Shows a Hello prompt.
    fn sign(
        &self,
        key_name: &str,
        challenge: &[u8; CHALLENGE_LEN],
    ) -> Result<Zeroizing<Vec<u8>>, DeviceError>;
    fn delete_key(&self, key_name: &str) -> Result<(), DeviceError>;
    /// DPAPI for the current Windows user, with no prompt.
    fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError>;
    fn unprotect(&self, blob: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError>;
    /// Seconds since Windows started. `None` if it can't be read.
    fn uptime_secs(&self) -> Option<u64>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum QuickUnlockError {
    #[error("Windows Hello is not available")]
    Unavailable,
    /// Quick unlock is off, a rule asks for the password, or the slot was
    /// rejected. Indistinguishable on purpose.
    #[error("the master password is required")]
    PasswordRequired,
    #[error("the Windows Hello prompt was cancelled")]
    Cancelled,
    #[error("Windows Hello failed")]
    Failed,
    #[error(transparent)]
    Vault(#[from] VaultError),
}

impl From<QuickUnlockError> for AppError {
    fn from(e: QuickUnlockError) -> Self {
        match e {
            QuickUnlockError::Unavailable => Self::QuickUnlockUnavailable,
            QuickUnlockError::PasswordRequired => Self::QuickUnlockPasswordRequired,
            QuickUnlockError::Cancelled => Self::QuickUnlockCancelled,
            QuickUnlockError::Failed => Self::QuickUnlockFailed,
            QuickUnlockError::Vault(e) => e.into(),
        }
    }
}

impl From<DeviceError> for QuickUnlockError {
    fn from(e: DeviceError) -> Self {
        match e {
            DeviceError::Cancelled => Self::Cancelled,
            DeviceError::KeyMissing | DeviceError::Failed => Self::Failed,
        }
    }
}

/// Whether the rules ask for the password. `boot_at` is when this Windows
/// session started; unknown counts as restarted.
pub fn password_reason(
    policy: PolicyRecord,
    failures: u8,
    now: i64,
    boot_at: Option<i64>,
) -> Option<PasswordReason> {
    if failures >= MAX_FAILURES {
        return Some(PasswordReason::TooManyAttempts);
    }
    let same_session = boot_at
        .is_some_and(|boot| boot.abs_diff(policy.boot_at) <= BOOT_TOLERANCE_SECS.unsigned_abs());
    if !same_session {
        return Some(PasswordReason::Restarted);
    }
    // A clock set back past the last password unlock also asks for it.
    let age = now.saturating_sub(policy.last_password_at);
    if !(0..=MAX_PASSWORD_AGE_SECS).contains(&age) {
        return Some(PasswordReason::Expired);
    }
    None
}

pub struct QuickUnlock {
    device: Arc<dyn QuickUnlockDevice>,
    /// `None` without `LOCALAPPDATA`: quick unlock is then unavailable.
    devices_dir: Option<PathBuf>,
    clock: Arc<dyn Clock>,
    /// One slot operation at a time, so a failure count is never lost.
    gate: Mutex<()>,
}

impl std::fmt::Debug for QuickUnlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QuickUnlock").finish_non_exhaustive()
    }
}

impl QuickUnlock {
    /// `app_dir` is `%LOCALAPPDATA%\Vaultair`.
    pub fn new(
        device: Arc<dyn QuickUnlockDevice>,
        app_dir: Option<PathBuf>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            device,
            devices_dir: app_dir.map(|d| d.join(DEVICES_DIR)),
            clock,
            gate: Mutex::new(()),
        }
    }

    fn gate(&self) -> MutexGuard<'_, ()> {
        self.gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn now(&self) -> i64 {
        self.clock.now_utc().unix_timestamp()
    }

    fn boot_at(&self) -> Option<i64> {
        let uptime = i64::try_from(self.device.uptime_secs()?).ok()?;
        Some(self.now().saturating_sub(uptime))
    }

    fn path(&self, vault_id: &str) -> Option<PathBuf> {
        slot_path(self.devices_dir.as_deref()?, vault_id)
    }

    /// The slot stored for `vault_id`, if it reads back whole.
    fn load(&self, vault_id: &str) -> Option<DeviceSlot> {
        let bytes = fs::read(self.path(vault_id)?).ok()?;
        let inner = Zeroizing::new(self.device.unprotect(&bytes, vault_id.as_bytes()).ok()?);
        DeviceSlot::decode(&inner)
            .ok()
            .filter(|slot| slot.vault_id() == vault_id)
    }

    /// The slot for the vault `header` belongs to, if it was made for that
    /// header. One made for another header (an older password, or a
    /// restored copy with a different one) is left alone.
    fn load_for(&self, header: &VaultHeader, binding: &Binding) -> Option<DeviceSlot> {
        self.load(&header.vault_id)
            .filter(|slot| slot.is_for(&header.vault_id, binding))
    }

    fn save(&self, slot: &DeviceSlot) -> Result<(), QuickUnlockError> {
        let path = self
            .path(slot.vault_id())
            .ok_or(QuickUnlockError::Unavailable)?;
        let blob = self
            .device
            .protect(&slot.encode(), slot.vault_id().as_bytes())
            .map_err(|_| QuickUnlockError::Failed)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(VaultError::from)?;
        }
        let tmp = path.with_extension("qu.tmp");
        write_atomic(&path, &tmp, &blob).map_err(VaultError::from)?;
        Ok(())
    }

    /// Deletes the slot and the Hello key. Missing ones are fine.
    fn discard(&self, vault_id: &str) {
        if let Some(path) = self.path(vault_id) {
            match fs::remove_file(&path) {
                Ok(()) => tracing::info!("quick unlock slot removed"),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    tracing::warn!(kind = ?e.kind(), "could not remove the quick unlock slot");
                }
            }
        }
        if self.device.hello() == HelloState::Available {
            let _ = self.device.delete_key(&key_name(vault_id));
        }
    }

    fn status_of(&self, slot: Option<&DeviceSlot>) -> QuickUnlockStatus {
        let hello = self.device.hello();
        QuickUnlockStatus {
            hello,
            hardware_backed: self.device.has_tpm(),
            enabled: slot.is_some(),
            password_required: slot.and_then(|slot| {
                if hello == HelloState::Available {
                    password_reason(
                        slot.policy_hint(),
                        slot.failures(),
                        self.now(),
                        self.boot_at(),
                    )
                } else {
                    Some(PasswordReason::HelloUnavailable)
                }
            }),
        }
    }

    /// Whether the vault in `vault_dir` can be unlocked with Hello right
    /// now. Works while locked; reads only the header and the slot.
    pub fn status(&self, vault_dir: &Path) -> QuickUnlockStatus {
        let _gate = self.gate();
        let slot = vault::read_header(vault_dir)
            .ok()
            .and_then(|header| self.load_for(&header, &header_binding(&header)));
        self.status_of(slot.as_ref())
    }

    /// Turns quick unlock on for the open vault. Checks the master
    /// password, creates the Hello key (one Hello prompt) and writes the slot.
    pub fn enable(
        &self,
        session: &SessionManager,
        password: &SecretString,
    ) -> Result<QuickUnlockStatus, QuickUnlockError> {
        if self.device.hello() != HelloState::Available || self.devices_dir.is_none() {
            return Err(QuickUnlockError::Unavailable);
        }
        let header = session.with_vault(|v| Ok::<_, VaultError>(v.header().clone()))?;
        // Argon2, outside the session lock.
        let keys =
            VaultKeys::derive(vault::unwrap_dek(&header, password)?).map_err(VaultError::from)?;
        let binding = header_binding(&header);
        let name = key_name(&header.vault_id);

        let _gate = self.gate();
        self.device.enroll(&name)?;
        let sealed = self.seal(&header, &binding, &keys, &name).and_then(|slot| {
            // A password change that landed meanwhile would void the slot.
            let unchanged = session.with_vault(|v| Ok::<_, VaultError>(v.header() == &header))?;
            if !unchanged {
                return Err(VaultError::Io(std::io::ErrorKind::Interrupted).into());
            }
            self.save(&slot)?;
            Ok(slot)
        });
        match sealed {
            Ok(slot) => {
                tracing::info!(
                    hardware_backed = self.device.has_tpm(),
                    "quick unlock turned on"
                );
                Ok(self.status_of(Some(&slot)))
            }
            Err(e) => {
                let _ = self.device.delete_key(&name);
                Err(e)
            }
        }
    }

    fn seal(
        &self,
        header: &VaultHeader,
        binding: &Binding,
        keys: &VaultKeys,
        name: &str,
    ) -> Result<DeviceSlot, QuickUnlockError> {
        let challenge = DeviceSlot::new_challenge().map_err(|_| QuickUnlockError::Failed)?;
        // Windows reuses the approval just given, so this doesn't prompt again.
        let signature = self.device.sign(name, &challenge)?;
        let slot = DeviceSlot::seal(
            &header.vault_id,
            binding,
            keys.dek(),
            keys.device_policy_key(),
            &challenge,
            &signature,
            PolicyRecord {
                last_password_at: self.now(),
                boot_at: self.boot_at().unwrap_or_default(),
            },
        )
        .map_err(|_| QuickUnlockError::Failed)?;
        // What was just written must open again, or it is no use later.
        slot.open(binding, &signature)
            .map_err(|_| QuickUnlockError::Failed)?;
        Ok(slot)
    }

    /// Unlocks the vault in `vault_dir` with Hello (one prompt). Any error
    /// leaves it locked, and the UI falls back to the password.
    pub fn unlock(
        &self,
        session: &SessionManager,
        vault_dir: &Path,
    ) -> Result<VaultInfo, QuickUnlockError> {
        let _gate = self.gate();
        let header = vault::read_header(vault_dir)?;
        let binding = header_binding(&header);
        let vault_id = header.vault_id.as_str();
        let mut slot = self
            .load_for(&header, &binding)
            .ok_or(QuickUnlockError::PasswordRequired)?;
        if self.status_of(Some(&slot)).password_required.is_some() {
            return Err(QuickUnlockError::PasswordRequired);
        }
        let challenge = slot
            .challenge()
            .map_err(|_| QuickUnlockError::PasswordRequired)?;

        let signature = match self.device.sign(&key_name(vault_id), &challenge) {
            Ok(signature) => signature,
            Err(DeviceError::KeyMissing) => {
                // Hello was reset. The slot can never open again.
                self.discard(vault_id);
                return Err(QuickUnlockError::PasswordRequired);
            }
            Err(e) => {
                slot.set_failures(slot.failures().saturating_add(1));
                if self.save(&slot).is_err() {
                    tracing::warn!("could not record a failed quick unlock");
                }
                return Err(e.into());
            }
        };

        // From here a failure means the slot is no good (changed bytes, or
        // a signature that came out differently): back to the password.
        let opened = slot
            .open(&binding, &signature)
            .ok()
            .and_then(|dek| VaultKeys::derive(dek).ok())
            .and_then(|keys| {
                let policy = slot
                    .verified_policy(&binding, keys.device_policy_key())
                    .ok()?;
                Some((keys, policy))
            });
        let Some((keys, policy)) = opened else {
            tracing::warn!("quick unlock slot rejected; removing it");
            self.discard(vault_id);
            return Err(QuickUnlockError::PasswordRequired);
        };
        // The same rules again, now on the record the vault's key vouches for.
        if password_reason(policy, slot.failures(), self.now(), self.boot_at()).is_some() {
            return Err(QuickUnlockError::PasswordRequired);
        }

        let info = session.unlock_quick(vault_dir, keys, &binding)?;
        if slot.failures() != 0 {
            slot.set_failures(0);
            if self.save(&slot).is_err() {
                tracing::warn!("could not reset the quick unlock failure count");
            }
        }
        tracing::info!("vault unlocked with Windows Hello");
        Ok(info)
    }

    /// Call after every master-password unlock: restarts the 7 days, notes
    /// this Windows session and clears the failure count.
    pub fn record_password_unlock(&self, session: &SessionManager) {
        let _gate = self.gate();
        let result = session.with_vault(|v| {
            let binding = header_binding(v.header());
            let Some(mut slot) = self.load_for(v.header(), &binding) else {
                return Ok(());
            };
            slot.set_policy(
                &binding,
                v.keys().device_policy_key(),
                PolicyRecord {
                    last_password_at: self.now(),
                    boot_at: self.boot_at().unwrap_or_default(),
                },
            );
            slot.set_failures(0);
            self.save(&slot)
        });
        if result.is_err() {
            tracing::warn!("could not refresh the quick unlock record");
        }
    }

    /// Turns quick unlock off for the open vault on this PC. Asks for the
    /// master password, like every change to quick unlock.
    pub fn forget(
        &self,
        session: &SessionManager,
        password: &SecretString,
    ) -> Result<QuickUnlockStatus, QuickUnlockError> {
        session.verify_password(password)?;
        let vault_id = session.with_vault(|v| Ok::<_, VaultError>(v.header().vault_id.clone()))?;
        let _gate = self.gate();
        self.discard(&vault_id);
        tracing::info!("quick unlock turned off");
        Ok(self.status_of(None))
    }

    /// Removes the slot after the master password or the KDF changed. The
    /// slot is already void (it is bound to the old header); this tidies up.
    pub fn invalidate(&self, vault_id: &str) {
        let _gate = self.gate();
        self.discard(vault_id);
    }

    /// Whether quick unlock is on for the open vault. When it is, some
    /// settings ask for the master password (ADR-0005 decision 4).
    pub fn enabled_for_open_vault(&self, session: &SessionManager) -> bool {
        let _gate = self.gate();
        session
            .with_vault(|v| {
                let binding = header_binding(v.header());
                Ok::<_, VaultError>(self.load_for(v.header(), &binding).is_some())
            })
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use hmac::{Hmac, KeyInit, Mac};
    use sha2::Sha256;

    use super::*;
    use crate::clock::ManualClock;
    use crate::crypto::kdf::KdfParams;
    use crate::crypto::rng;
    use crate::service::session::VaultStatus;
    use crate::vault::device_slot::{MAGIC, SLOT_VERSION};
    use crate::vault::CreateOptions;

    const PASSWORD: &str = "orbit lantern cactus mosaic";
    const NEW_PASSWORD: &str = "velvet harbor quartz meadow";
    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    fn pw(s: &str) -> SecretString {
        SecretString::from(s)
    }

    /// Hello, DPAPI and the uptime, in memory. Signing is an HMAC under a
    /// per-key secret, so it is deterministic like the real thing.
    struct FakeDevice {
        clock: Arc<ManualClock>,
        hello: Mutex<HelloState>,
        keys: Mutex<HashMap<String, [u8; 32]>>,
        /// When "Windows" started, in Unix seconds.
        booted_at: Mutex<i64>,
        cancel: AtomicBool,
        prompts: AtomicUsize,
    }

    impl FakeDevice {
        fn new(clock: Arc<ManualClock>) -> Self {
            Self {
                clock,
                hello: Mutex::new(HelloState::Available),
                keys: Mutex::default(),
                booted_at: Mutex::new(-3_600),
                cancel: AtomicBool::new(false),
                prompts: AtomicUsize::new(0),
            }
        }

        fn restart_windows(&self) {
            *self.booted_at.lock().unwrap() = self.clock.now_utc().unix_timestamp();
        }

        fn prompts(&self) -> usize {
            self.prompts.load(Ordering::SeqCst)
        }

        fn prompt(&self) -> Result<(), DeviceError> {
            self.prompts.fetch_add(1, Ordering::SeqCst);
            if self.cancel.load(Ordering::SeqCst) {
                Err(DeviceError::Cancelled)
            } else {
                Ok(())
            }
        }

        fn mask(entropy: &[u8], len: usize) -> Vec<u8> {
            entropy.iter().copied().cycle().take(len).collect()
        }
    }

    impl QuickUnlockDevice for FakeDevice {
        fn hello(&self) -> HelloState {
            *self.hello.lock().unwrap()
        }

        fn has_tpm(&self) -> bool {
            true
        }

        fn enroll(&self, key_name: &str) -> Result<(), DeviceError> {
            self.prompt()?;
            self.keys
                .lock()
                .unwrap()
                .insert(key_name.to_owned(), rng::bytes::<32>().unwrap());
            Ok(())
        }

        fn sign(
            &self,
            key_name: &str,
            challenge: &[u8; CHALLENGE_LEN],
        ) -> Result<Zeroizing<Vec<u8>>, DeviceError> {
            let secret = *self
                .keys
                .lock()
                .unwrap()
                .get(key_name)
                .ok_or(DeviceError::KeyMissing)?;
            self.prompt()?;
            let mut signature = Zeroizing::new(Vec::with_capacity(256));
            for block in 0u8..8 {
                let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&secret).unwrap();
                mac.update(&[block]);
                mac.update(challenge);
                signature.extend_from_slice(&mac.finalize().into_bytes());
            }
            Ok(signature)
        }

        fn delete_key(&self, key_name: &str) -> Result<(), DeviceError> {
            self.keys.lock().unwrap().remove(key_name);
            Ok(())
        }

        fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError> {
            let mask = Self::mask(entropy, plain.len());
            Ok(plain.iter().zip(mask).map(|(b, m)| b ^ m).collect())
        }

        fn unprotect(&self, blob: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError> {
            self.protect(blob, entropy)
        }

        fn uptime_secs(&self) -> Option<u64> {
            let now = self.clock.now_utc().unix_timestamp();
            u64::try_from(now - *self.booted_at.lock().unwrap()).ok()
        }
    }

    struct Harness {
        _vaults: tempfile::TempDir,
        app: tempfile::TempDir,
        clock: Arc<ManualClock>,
        device: Arc<FakeDevice>,
        session: SessionManager,
        quick: QuickUnlock,
        dir: PathBuf,
        vault_id: String,
    }

    impl Harness {
        /// A new vault, unlocked with its password.
        fn new() -> Self {
            let vaults = tempfile::tempdir().unwrap();
            let app = tempfile::tempdir().unwrap();
            let clock = Arc::new(ManualClock::default());
            let device = Arc::new(FakeDevice::new(clock.clone()));
            let session = SessionManager::new(clock.clone());
            let info = session
                .create(
                    &CreateOptions {
                        parent_dir: vaults.path().to_path_buf(),
                        name: "Quick".into(),
                        kdf: KdfParams::MINIMUM,
                        demo: false,
                    },
                    &pw(PASSWORD),
                )
                .unwrap();
            let quick = QuickUnlock::new(
                device.clone(),
                Some(app.path().to_path_buf()),
                clock.clone(),
            );
            Self {
                _vaults: vaults,
                app,
                clock,
                device,
                session,
                quick,
                dir: PathBuf::from(info.path),
                vault_id: info.vault_id,
            }
        }

        /// Quick unlock on, vault locked.
        fn enabled() -> Self {
            let h = Self::new();
            h.quick.enable(&h.session, &pw(PASSWORD)).unwrap();
            assert!(h.session.lock());
            h
        }

        fn slot_file(&self) -> PathBuf {
            self.app
                .path()
                .join(DEVICES_DIR)
                .join(format!("{}.qu", self.vault_id))
        }

        fn unlock(&self) -> Result<VaultInfo, QuickUnlockError> {
            self.quick.unlock(&self.session, &self.dir)
        }

        fn password_unlock(&self, password: &str) {
            self.session.unlock(&self.dir, &pw(password)).unwrap();
            self.quick.record_password_unlock(&self.session);
        }

        fn is_unlocked(&self) -> bool {
            matches!(self.session.status(), VaultStatus::Unlocked { .. })
        }

        fn reason(&self) -> Option<PasswordReason> {
            self.quick.status(&self.dir).password_required
        }

        /// Rewrites the stored slot's JSON, keeping the frame and CRC valid,
        /// as someone editing the file on purpose would.
        fn edit_slot(&self, edit: impl FnOnce(&mut serde_json::Value)) {
            let entropy = self.vault_id.as_bytes();
            let stored = fs::read(self.slot_file()).unwrap();
            let inner = self.device.unprotect(&stored, entropy).unwrap();
            let mut body: serde_json::Value =
                serde_json::from_slice(&inner[16..inner.len() - 4]).unwrap();
            edit(&mut body);
            let body = serde_json::to_vec(&body).unwrap();
            let mut out = MAGIC.to_vec();
            out.extend_from_slice(&SLOT_VERSION.to_le_bytes());
            out.extend_from_slice(&u32::try_from(body.len()).unwrap().to_le_bytes());
            out.extend_from_slice(&body);
            let crc = crc32fast::hash(&out);
            out.extend_from_slice(&crc.to_le_bytes());
            fs::write(
                self.slot_file(),
                self.device.protect(&out, entropy).unwrap(),
            )
            .unwrap();
        }
    }

    #[test]
    fn hello_unlocks_after_one_password_unlock() {
        let h = Harness::new();
        assert!(!h.quick.status(&h.dir).enabled);
        let status = h.quick.enable(&h.session, &pw(PASSWORD)).unwrap();
        assert_eq!(
            status,
            QuickUnlockStatus {
                hello: HelloState::Available,
                hardware_backed: true,
                enabled: true,
                password_required: None,
            }
        );
        assert!(h.quick.enabled_for_open_vault(&h.session));
        // Creating the key and the first signature. (Windows shows one
        // prompt for the two; the fake counts each call.)
        assert_eq!(h.device.prompts(), 2);

        assert!(h.session.lock());
        let info = h.unlock().unwrap();
        assert_eq!(info.vault_id, h.vault_id);
        assert!(h.session.integrity_check().unwrap().ok);

        // Relock and reopen as often as you like within the rules.
        assert!(h.session.lock());
        assert!(h.unlock().is_ok());
    }

    #[test]
    fn turning_it_on_needs_the_master_password() {
        let h = Harness::new();
        assert_eq!(
            h.quick.enable(&h.session, &pw(NEW_PASSWORD)).err(),
            Some(QuickUnlockError::Vault(VaultError::WrongPasswordOrTampered))
        );
        assert_eq!(h.device.prompts(), 0);
        assert!(!h.slot_file().exists());
    }

    #[test]
    fn a_cancelled_enrollment_leaves_nothing_behind() {
        let h = Harness::new();
        h.device.cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            h.quick.enable(&h.session, &pw(PASSWORD)).err(),
            Some(QuickUnlockError::Cancelled)
        );
        assert!(!h.slot_file().exists());
        assert!(h.device.keys.lock().unwrap().is_empty());
    }

    #[test]
    fn without_hello_it_cannot_be_turned_on() {
        let h = Harness::new();
        *h.device.hello.lock().unwrap() = HelloState::NotSetUp;
        assert_eq!(
            h.quick.enable(&h.session, &pw(PASSWORD)).err(),
            Some(QuickUnlockError::Unavailable)
        );
    }

    #[test]
    fn a_windows_restart_asks_for_the_password() {
        let h = Harness::enabled();
        h.clock.advance(Duration::from_secs(600));
        h.device.restart_windows();
        let prompts = h.device.prompts();

        assert_eq!(h.reason(), Some(PasswordReason::Restarted));
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert_eq!(h.device.prompts(), prompts, "no Hello prompt is shown");
        assert!(!h.is_unlocked());

        // One password unlock in the new session and Hello works again.
        h.password_unlock(PASSWORD);
        assert!(h.session.lock());
        assert_eq!(h.reason(), None);
        assert!(h.unlock().is_ok());
    }

    #[test]
    fn seven_days_after_the_password_it_is_asked_for_again() {
        let h = Harness::enabled();
        h.clock.advance(7 * DAY);
        assert_eq!(h.reason(), None);
        assert!(h.unlock().is_ok());
        assert!(h.session.lock());

        // A Hello unlock doesn't restart the 7 days.
        h.clock.advance(Duration::from_secs(1));
        assert_eq!(h.reason(), Some(PasswordReason::Expired));
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));

        h.password_unlock(PASSWORD);
        assert!(h.session.lock());
        h.clock.advance(6 * DAY);
        assert!(h.unlock().is_ok());
    }

    #[test]
    fn three_failed_attempts_ask_for_the_password() {
        let h = Harness::enabled();
        h.device.cancel.store(true, Ordering::SeqCst);
        for _ in 0..2 {
            assert_eq!(h.unlock().err(), Some(QuickUnlockError::Cancelled));
        }
        // A success before the third failure clears the count.
        h.device.cancel.store(false, Ordering::SeqCst);
        assert!(h.unlock().is_ok());
        assert!(h.session.lock());

        h.device.cancel.store(true, Ordering::SeqCst);
        for _ in 0..3 {
            assert_eq!(h.unlock().err(), Some(QuickUnlockError::Cancelled));
        }
        h.device.cancel.store(false, Ordering::SeqCst);
        let prompts = h.device.prompts();
        assert_eq!(h.reason(), Some(PasswordReason::TooManyAttempts));
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert_eq!(h.device.prompts(), prompts);

        h.password_unlock(PASSWORD);
        assert!(h.session.lock());
        assert!(h.unlock().is_ok());
    }

    #[test]
    fn a_changed_password_voids_the_slot() {
        let h = Harness::enabled();
        h.session.unlock(&h.dir, &pw(PASSWORD)).unwrap();
        h.session
            .rewrap(&pw(PASSWORD), Some(&pw(NEW_PASSWORD)), None)
            .unwrap();
        assert!(h.session.lock());
        let prompts = h.device.prompts();

        // Even with the old slot still on disk.
        assert!(h.slot_file().exists());
        assert!(!h.quick.status(&h.dir).enabled);
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert_eq!(h.device.prompts(), prompts);
        assert!(!h.is_unlocked());

        h.quick.invalidate(&h.vault_id);
        assert!(!h.slot_file().exists());
        assert!(h.device.keys.lock().unwrap().is_empty());
    }

    #[test]
    fn a_slot_claiming_the_new_header_still_fails_to_open() {
        let h = Harness::enabled();
        h.session.unlock(&h.dir, &pw(PASSWORD)).unwrap();
        h.session
            .rewrap(&pw(PASSWORD), Some(&pw(NEW_PASSWORD)), None)
            .unwrap();
        assert!(h.session.lock());
        let binding = header_binding(&vault::read_header(&h.dir).unwrap());
        h.edit_slot(|slot| {
            use base64::Engine;
            slot["binding_b64"] = base64::engine::general_purpose::STANDARD
                .encode(binding)
                .into();
        });

        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert!(!h.is_unlocked());
        assert!(!h.slot_file().exists(), "a rejected slot is removed");
    }

    #[test]
    fn a_forged_policy_record_is_refused() {
        let h = Harness::enabled();
        h.clock.advance(8 * DAY);
        assert_eq!(h.reason(), Some(PasswordReason::Expired));

        // Claim the password was typed just now.
        let now = h.clock.now_utc().unix_timestamp();
        h.edit_slot(|slot| slot["policy"]["last_password_at"] = now.into());
        assert_eq!(h.reason(), None, "the unauthenticated hint is fooled");

        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert!(!h.is_unlocked());
        assert!(!h.slot_file().exists());
    }

    #[test]
    fn an_edited_failure_count_only_buys_more_hello_prompts() {
        let h = Harness::enabled();
        h.device.cancel.store(true, Ordering::SeqCst);
        for _ in 0..3 {
            let _ = h.unlock();
        }
        h.edit_slot(|slot| slot["failures"] = 0.into());
        // Still nothing opens without an approved prompt.
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::Cancelled));
        assert!(!h.is_unlocked());
    }

    #[test]
    fn a_damaged_slot_falls_back_to_the_password() {
        let h = Harness::enabled();
        let mut bytes = fs::read(h.slot_file()).unwrap();
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0x01;
        fs::write(h.slot_file(), bytes).unwrap();

        assert!(!h.quick.status(&h.dir).enabled);
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert!(!h.is_unlocked());
    }

    #[test]
    fn another_vaults_slot_does_not_open_this_one() {
        let a = Harness::enabled();
        let b = Harness::enabled();
        fs::copy(a.slot_file(), b.slot_file()).unwrap();
        assert!(!b.quick.status(&b.dir).enabled);
        assert_eq!(b.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert!(!b.is_unlocked());
    }

    #[test]
    fn a_missing_hello_key_falls_back_to_the_password() {
        let h = Harness::enabled();
        h.device.keys.lock().unwrap().clear();
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert!(!h.slot_file().exists());
    }

    #[test]
    fn hello_removed_from_windows_falls_back_to_the_password() {
        let h = Harness::enabled();
        *h.device.hello.lock().unwrap() = HelloState::NotSetUp;
        let prompts = h.device.prompts();
        assert_eq!(h.reason(), Some(PasswordReason::HelloUnavailable));
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
        assert_eq!(h.device.prompts(), prompts);
    }

    #[test]
    fn forgetting_needs_the_password_and_removes_the_slot_and_key() {
        let h = Harness::new();
        h.quick.enable(&h.session, &pw(PASSWORD)).unwrap();
        assert_eq!(
            h.quick.forget(&h.session, &pw(NEW_PASSWORD)).err(),
            Some(QuickUnlockError::Vault(VaultError::WrongPasswordOrTampered))
        );
        assert!(h.slot_file().exists());

        let status = h.quick.forget(&h.session, &pw(PASSWORD)).unwrap();
        assert!(!status.enabled);
        assert!(!h.slot_file().exists());
        assert!(h.device.keys.lock().unwrap().is_empty());
        assert!(!h.quick.enabled_for_open_vault(&h.session));

        assert!(h.session.lock());
        assert_eq!(h.unlock().err(), Some(QuickUnlockError::PasswordRequired));
    }

    #[test]
    fn the_data_key_never_reaches_the_slot_file_or_an_error() {
        let h = Harness::new();
        h.quick.enable(&h.session, &pw(PASSWORD)).unwrap();
        let dek = h
            .session
            .with_vault(|v| Ok::<_, VaultError>(*v.keys().dek().as_bytes()))
            .unwrap();
        let stored = fs::read(h.slot_file()).unwrap();
        let inner = h.device.unprotect(&stored, h.vault_id.as_bytes()).unwrap();
        for bytes in [&stored, &inner] {
            assert!(!bytes.windows(dek.len()).any(|w| w == dek));
        }
        // No temporary copy is left beside it.
        let files: Vec<_> = fs::read_dir(h.app.path().join(DEVICES_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(files.len(), 1);

        for e in [
            QuickUnlockError::Unavailable,
            QuickUnlockError::PasswordRequired,
            QuickUnlockError::Cancelled,
            QuickUnlockError::Failed,
        ] {
            let app = AppError::from(e.clone());
            let json = serde_json::to_value(&app).unwrap();
            let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
            assert_eq!(keys, ["code", "message"], "{e:?}");
        }
    }

    #[test]
    fn the_rules() {
        let policy = PolicyRecord {
            last_password_at: 1_000_000,
            boot_at: 900_000,
        };
        let now = policy.last_password_at + 60;
        let boot = Some(policy.boot_at);
        assert_eq!(password_reason(policy, 0, now, boot), None);
        assert_eq!(password_reason(policy, 2, now, boot), None);
        assert_eq!(
            password_reason(policy, 3, now, boot),
            Some(PasswordReason::TooManyAttempts)
        );

        // The uptime reading wobbles; a restart doesn't hide in the wobble.
        assert_eq!(
            password_reason(policy, 0, now, Some(policy.boot_at + BOOT_TOLERANCE_SECS)),
            None
        );
        assert_eq!(
            password_reason(policy, 0, now, Some(policy.boot_at - BOOT_TOLERANCE_SECS)),
            None
        );
        for restarted in [
            Some(policy.boot_at + BOOT_TOLERANCE_SECS + 1),
            Some(policy.boot_at - BOOT_TOLERANCE_SECS - 1),
            None,
        ] {
            assert_eq!(
                password_reason(policy, 0, now, restarted),
                Some(PasswordReason::Restarted)
            );
        }

        let at_limit = policy.last_password_at + MAX_PASSWORD_AGE_SECS;
        assert_eq!(password_reason(policy, 0, at_limit, boot), None);
        assert_eq!(
            password_reason(policy, 0, at_limit + 1, boot),
            Some(PasswordReason::Expired)
        );
        // The clock was set back to before the password was typed.
        assert_eq!(
            password_reason(policy, 0, policy.last_password_at - 1, boot),
            Some(PasswordReason::Expired)
        );
    }

    #[test]
    fn key_names_have_no_slash() {
        let name = key_name("0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
        assert_eq!(name, "Vaultair-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
        assert!(!name.contains('/'));
    }
}
