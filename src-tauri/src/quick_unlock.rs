//! Connects quick unlock's rules (`vaultair_core::service::quick_unlock`)
//! to Windows: Hello keys, DPAPI, the TPM check and the uptime from
//! `vaultair-platform`.

use std::sync::Arc;

use vaultair_core::service::quick_unlock::{DeviceError, HelloState, QuickUnlockDevice};
use vaultair_core::vault::device_slot::CHALLENGE_LEN;
use vaultair_platform::{
    DeviceProtection, HelloAvailability, HelloError, QuickUnlockKey, SystemInfo,
};
use zeroize::Zeroizing;

pub struct HelloDevice {
    key: Arc<dyn QuickUnlockKey>,
    protection: Arc<dyn DeviceProtection>,
    system: Arc<dyn SystemInfo>,
}

impl std::fmt::Debug for HelloDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HelloDevice").finish_non_exhaustive()
    }
}

impl HelloDevice {
    pub fn new(
        key: Arc<dyn QuickUnlockKey>,
        protection: Arc<dyn DeviceProtection>,
        system: Arc<dyn SystemInfo>,
    ) -> Self {
        Self {
            key,
            protection,
            system,
        }
    }

    #[cfg(windows)]
    pub fn for_this_pc() -> Self {
        use vaultair_platform::windows::{WindowsDpapi, WindowsHello, WindowsSystem};
        Self::new(
            Arc::new(WindowsHello),
            Arc::new(WindowsDpapi),
            Arc::new(WindowsSystem),
        )
    }

    #[cfg(not(windows))]
    pub fn for_this_pc() -> Self {
        Self::new(
            Arc::new(unsupported::Unsupported),
            Arc::new(unsupported::Unsupported),
            Arc::new(unsupported::Unsupported),
        )
    }
}

/// Logs the static cause; the UI only learns "cancelled" or "failed".
fn device_error(e: HelloError) -> DeviceError {
    match e {
        HelloError::Cancelled => DeviceError::Cancelled,
        HelloError::KeyNotFound => DeviceError::KeyMissing,
        HelloError::Failed { context } => {
            tracing::warn!(context, "Windows Hello call failed");
            DeviceError::Failed
        }
    }
}

impl QuickUnlockDevice for HelloDevice {
    fn hello(&self) -> HelloState {
        match self.key.available() {
            HelloAvailability::Available => HelloState::Available,
            HelloAvailability::NotSetUp => HelloState::NotSetUp,
            HelloAvailability::Unsupported => HelloState::Unsupported,
        }
    }

    fn has_tpm(&self) -> bool {
        self.system.has_tpm()
    }

    fn enroll(&self, key_name: &str) -> Result<(), DeviceError> {
        self.key.enroll(key_name).map_err(device_error)
    }

    fn sign(
        &self,
        key_name: &str,
        challenge: &[u8; CHALLENGE_LEN],
    ) -> Result<Zeroizing<Vec<u8>>, DeviceError> {
        self.key.sign(key_name, challenge).map_err(device_error)
    }

    fn delete_key(&self, key_name: &str) -> Result<(), DeviceError> {
        self.key.delete(key_name).map_err(device_error)
    }

    fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError> {
        self.protection.protect(plain, entropy).map_err(|e| {
            tracing::warn!(error = %e, "could not protect the quick unlock slot");
            DeviceError::Failed
        })
    }

    fn unprotect(&self, protected: &[u8], entropy: &[u8]) -> Result<Vec<u8>, DeviceError> {
        // Fails for another Windows user's slot or a changed file. Not worth
        // a log line each time the lock screen asks.
        self.protection
            .unprotect(protected, entropy)
            .map_err(|_| DeviceError::Failed)
    }

    fn uptime_secs(&self) -> Option<u64> {
        self.system.uptime_secs()
    }
}

/// Vaultair targets Windows; elsewhere quick unlock reports "unsupported".
#[cfg(not(windows))]
mod unsupported {
    use vaultair_platform::{
        DeviceProtection, HelloAvailability, HelloError, PlatformError, QuickUnlockKey, SystemInfo,
    };
    use zeroize::Zeroizing;

    pub struct Unsupported;

    const FAILED: HelloError = HelloError::Failed {
        context: "unsupported",
    };

    impl QuickUnlockKey for Unsupported {
        fn available(&self) -> HelloAvailability {
            HelloAvailability::Unsupported
        }
        fn enroll(&self, _: &str) -> Result<(), HelloError> {
            Err(FAILED)
        }
        fn sign(&self, _: &str, _: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
            Err(FAILED)
        }
        fn delete(&self, _: &str) -> Result<(), HelloError> {
            Ok(())
        }
    }

    impl DeviceProtection for Unsupported {
        fn protect(&self, _: &[u8], _: &[u8]) -> Result<Vec<u8>, PlatformError> {
            Err(PlatformError::Unsupported)
        }
        fn unprotect(&self, _: &[u8], _: &[u8]) -> Result<Vec<u8>, PlatformError> {
            Err(PlatformError::Unsupported)
        }
    }

    impl SystemInfo for Unsupported {
        fn uptime_secs(&self) -> Option<u64> {
            None
        }
        fn has_tpm(&self) -> bool {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::path::PathBuf;

    use secrecy::SecretString;
    use vaultair_core::clock::SystemClock;
    use vaultair_core::crypto::kdf::KdfParams;
    use vaultair_core::service::quick_unlock::{
        key_name, PasswordReason, QuickUnlock, QuickUnlockError, DEVICES_DIR,
    };
    use vaultair_core::service::session::{SessionManager, VaultStatus};
    use vaultair_core::vault::CreateOptions;
    use vaultair_platform::fake::{FakeHello, FakeProtection, FakeSystem};

    use super::*;

    const PASSWORD: &str = "orbit lantern cactus mosaic";

    struct Harness {
        _vaults: tempfile::TempDir,
        app: tempfile::TempDir,
        hello: Arc<FakeHello>,
        system: Arc<FakeSystem>,
        session: SessionManager,
        quick: QuickUnlock,
        dir: PathBuf,
        vault_id: String,
    }

    fn harness() -> Harness {
        let vaults = tempfile::tempdir().unwrap();
        let app = tempfile::tempdir().unwrap();
        let hello = Arc::new(FakeHello::default());
        let system = Arc::new(FakeSystem::default());
        let session = SessionManager::default();
        let info = session
            .create(
                &CreateOptions {
                    parent_dir: vaults.path().to_path_buf(),
                    name: "Hello".into(),
                    kdf: KdfParams::MINIMUM,
                    demo: false,
                },
                &SecretString::from(PASSWORD),
            )
            .unwrap();
        let device = HelloDevice::new(hello.clone(), Arc::new(FakeProtection), system.clone());
        let quick = QuickUnlock::new(
            Arc::new(device),
            Some(app.path().to_path_buf()),
            Arc::new(SystemClock),
        );
        Harness {
            _vaults: vaults,
            app,
            hello,
            system,
            session,
            quick,
            dir: PathBuf::from(info.path),
            vault_id: info.vault_id,
        }
    }

    #[test]
    fn round_trip_with_fake_hello() {
        let h = harness();
        let status = h
            .quick
            .enable(&h.session, &SecretString::from(PASSWORD))
            .unwrap();
        assert!(status.enabled && status.hardware_backed);
        assert_eq!(status.password_required, None);
        assert!(h.hello.has_key(&key_name(&h.vault_id)));
        assert!(h
            .app
            .path()
            .join(DEVICES_DIR)
            .join(format!("{}.qu", h.vault_id))
            .is_file());

        assert!(h.session.lock());
        let info = h.quick.unlock(&h.session, &h.dir).unwrap();
        assert_eq!(info.vault_id, h.vault_id);
        assert!(matches!(h.session.status(), VaultStatus::Unlocked { .. }));
    }

    #[test]
    fn a_cancelled_prompt_leaves_the_vault_locked() {
        let h = harness();
        h.quick
            .enable(&h.session, &SecretString::from(PASSWORD))
            .unwrap();
        assert!(h.session.lock());

        h.hello.set_cancel(true);
        assert_eq!(
            h.quick.unlock(&h.session, &h.dir).err(),
            Some(QuickUnlockError::Cancelled)
        );
        assert_eq!(h.session.status(), VaultStatus::Locked);

        h.hello.set_cancel(false);
        assert!(h.quick.unlock(&h.session, &h.dir).is_ok());
    }

    #[test]
    fn the_platform_state_reaches_the_status() {
        let h = harness();
        h.system.set_tpm(false);
        let status = h
            .quick
            .enable(&h.session, &SecretString::from(PASSWORD))
            .unwrap();
        assert!(status.enabled && !status.hardware_backed);

        // An uptime that can't be read counts as a restart.
        h.system.set_uptime_secs(None);
        assert_eq!(
            h.quick.status(&h.dir).password_required,
            Some(PasswordReason::Restarted)
        );
        h.system.set_uptime_secs(Some(3_600));

        h.hello.set_availability(HelloAvailability::NotSetUp);
        let status = h.quick.status(&h.dir);
        assert_eq!(status.hello, HelloState::NotSetUp);
        assert_eq!(
            status.password_required,
            Some(PasswordReason::HelloUnavailable)
        );

        // Hello was reset: the key is gone, so the slot can't open again.
        h.hello.set_availability(HelloAvailability::Available);
        h.hello.remove_all_keys();
        assert!(h.session.lock());
        assert_eq!(
            h.quick.unlock(&h.session, &h.dir).err(),
            Some(QuickUnlockError::PasswordRequired)
        );
        assert!(!h.quick.status(&h.dir).enabled);
    }
}
