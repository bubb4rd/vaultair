//! In-memory stand-ins for the OS, for tests (`feature = "fake"`).

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use zeroize::Zeroizing;

use crate::{
    CaptureMode, CaptureProtection, Clipboard, ClipboardTicket, DeviceProtection,
    HelloAvailability, HelloError, PlatformError, QuickUnlockKey, SessionEvent, SessionEvents,
    SessionSink, SystemInfo,
};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Debug, Default)]
struct ClipboardState {
    text: Option<String>,
    sequence: u32,
    /// Set when the last write was marked sensitive.
    excluded_from_history: bool,
    busy: bool,
}

/// A clipboard with a sequence number that bumps on every change, like Windows.
#[derive(Debug, Default)]
pub struct FakeClipboard {
    state: Mutex<ClipboardState>,
}

impl FakeClipboard {
    pub fn text(&self) -> Option<String> {
        lock(&self.state).text.clone()
    }

    pub fn excluded_from_history(&self) -> bool {
        lock(&self.state).excluded_from_history
    }

    /// Another app copying something.
    pub fn user_copies(&self, text: &str) {
        let mut s = lock(&self.state);
        s.text = Some(text.to_owned());
        s.excluded_from_history = false;
        s.sequence += 1;
    }

    /// Another process holding the clipboard open.
    pub fn set_busy(&self, busy: bool) {
        lock(&self.state).busy = busy;
    }
}

impl Clipboard for FakeClipboard {
    fn write_sensitive(&self, text: &str) -> Result<ClipboardTicket, PlatformError> {
        let mut s = lock(&self.state);
        if s.busy {
            return Err(PlatformError::ClipboardBusy);
        }
        s.text = Some(text.to_owned());
        s.excluded_from_history = true;
        s.sequence += 1;
        Ok(ClipboardTicket {
            sequence: s.sequence,
        })
    }

    fn clear_if_unchanged(&self, ticket: ClipboardTicket) -> Result<bool, PlatformError> {
        let mut s = lock(&self.state);
        if s.busy {
            return Err(PlatformError::ClipboardBusy);
        }
        if s.sequence != ticket.sequence {
            return Ok(false);
        }
        s.text = None;
        s.excluded_from_history = false;
        s.sequence += 1;
        Ok(true)
    }
}

/// Session events a test injects with [`FakeSessionEvents::emit`].
#[derive(Default)]
pub struct FakeSessionEvents {
    sink: Mutex<Option<SessionSink>>,
}

impl std::fmt::Debug for FakeSessionEvents {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FakeSessionEvents").finish_non_exhaustive()
    }
}

impl FakeSessionEvents {
    pub fn emit(&self, event: SessionEvent) {
        if let Some(sink) = lock(&self.sink).as_ref() {
            sink(event);
        }
    }
}

impl SessionEvents for FakeSessionEvents {
    fn subscribe(&self, sink: SessionSink) -> Result<(), PlatformError> {
        *lock(&self.sink) = Some(sink);
        Ok(())
    }
}

/// Records the last capture setting.
#[derive(Debug, Default)]
pub struct FakeCapture {
    excluded: Mutex<Option<bool>>,
}

impl FakeCapture {
    /// `None` until the setting is first applied.
    pub fn excluded(&self) -> Option<bool> {
        *lock(&self.excluded)
    }
}

impl CaptureProtection for FakeCapture {
    fn set_excluded_from_capture(&self, excluded: bool) -> Result<CaptureMode, PlatformError> {
        *lock(&self.excluded) = Some(excluded);
        Ok(if excluded {
            CaptureMode::Excluded
        } else {
            CaptureMode::Visible
        })
    }
}

/// Windows Hello in memory. Each key is a random secret, and a signature
/// is a fixed mix of that secret and the challenge: the same challenge
/// always signs the same, as with the real thing. Not cryptography.
#[derive(Debug)]
pub struct FakeHello {
    availability: Mutex<HelloAvailability>,
    keys: Mutex<HashMap<String, u64>>,
    cancel: AtomicBool,
    prompts: AtomicUsize,
}

impl Default for FakeHello {
    fn default() -> Self {
        Self {
            availability: Mutex::new(HelloAvailability::Available),
            keys: Mutex::default(),
            cancel: AtomicBool::new(false),
            prompts: AtomicUsize::new(0),
        }
    }
}

impl FakeHello {
    pub fn set_availability(&self, availability: HelloAvailability) {
        *lock(&self.availability) = availability;
    }

    /// The user cancelling every prompt from now on.
    pub fn set_cancel(&self, cancel: bool) {
        self.cancel.store(cancel, Ordering::SeqCst);
    }

    /// Prompts shown so far, approved or not.
    pub fn prompts(&self) -> usize {
        self.prompts.load(Ordering::SeqCst)
    }

    pub fn has_key(&self, name: &str) -> bool {
        lock(&self.keys).contains_key(name)
    }

    /// Hello being reset: every key is gone.
    pub fn remove_all_keys(&self) {
        lock(&self.keys).clear();
    }

    fn prompt(&self) -> Result<(), HelloError> {
        self.prompts.fetch_add(1, Ordering::SeqCst);
        if self.cancel.load(Ordering::SeqCst) {
            Err(HelloError::Cancelled)
        } else {
            Ok(())
        }
    }
}

impl QuickUnlockKey for FakeHello {
    fn available(&self) -> HelloAvailability {
        *lock(&self.availability)
    }

    fn enroll(&self, name: &str, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
        self.prompt()?;
        // `RandomState` is seeded from the OS, which is random enough here.
        let secret = std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish();
        lock(&self.keys).insert(name.to_owned(), secret);
        Ok(fake_signature(secret, challenge))
    }

    fn sign(&self, name: &str, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
        let secret = *lock(&self.keys).get(name).ok_or(HelloError::KeyNotFound)?;
        self.prompt()?;
        Ok(fake_signature(secret, challenge))
    }

    fn delete(&self, name: &str) -> Result<(), HelloError> {
        lock(&self.keys).remove(name);
        Ok(())
    }
}

fn fake_signature(secret: u64, challenge: &[u8]) -> Zeroizing<Vec<u8>> {
    {
        let mut state = secret;
        let mut signature = Zeroizing::new(Vec::with_capacity(256));
        for i in 0..256usize {
            let byte = challenge
                .get(i % challenge.len().max(1))
                .copied()
                .unwrap_or(0);
            // SplitMix64 steps, fed with the challenge.
            state = state
                .wrapping_add(0x9E37_79B9_7F4A_7C15)
                .wrapping_add(u64::from(byte));
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            signature.push((z ^ (z >> 31)).to_le_bytes()[0]);
        }
        signature
    }
}

/// Stands in for DPAPI: reversible, tied to the entropy, and it notices
/// bytes that aren't its own. Protects nothing.
#[derive(Debug, Default, Clone, Copy)]
pub struct FakeProtection;

const FAKE_PROTECTION_TAG: &[u8; 4] = b"FDP1";

fn masked(bytes: &[u8], entropy: &[u8]) -> Vec<u8> {
    // Every entropy byte reaches every output byte, so a different entropy
    // always garbles the tag.
    let fold = entropy.iter().fold(0u8, |acc, b| acc.rotate_left(1) ^ b);
    bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ fold ^ entropy.get(i % entropy.len().max(1)).copied().unwrap_or(0))
        .collect()
}

impl DeviceProtection for FakeProtection {
    fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError> {
        Ok(masked(
            &[FAKE_PROTECTION_TAG.as_slice(), plain].concat(),
            entropy,
        ))
    }

    fn unprotect(&self, protected: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError> {
        let plain = masked(protected, entropy);
        match plain.strip_prefix(FAKE_PROTECTION_TAG) {
            Some(rest) => Ok(rest.to_vec()),
            None => Err(PlatformError::Os {
                context: "fake unprotect",
            }),
        }
    }
}

/// An uptime and a TPM a test sets.
#[derive(Debug)]
pub struct FakeSystem {
    uptime_secs: Mutex<Option<u64>>,
    tpm: AtomicBool,
}

impl Default for FakeSystem {
    fn default() -> Self {
        Self {
            uptime_secs: Mutex::new(Some(3_600)),
            tpm: AtomicBool::new(true),
        }
    }
}

impl FakeSystem {
    pub fn set_uptime_secs(&self, uptime: Option<u64>) {
        *lock(&self.uptime_secs) = uptime;
    }

    pub fn set_tpm(&self, present: bool) {
        self.tpm.store(present, Ordering::SeqCst);
    }
}

impl SystemInfo for FakeSystem {
    fn uptime_secs(&self) -> Option<u64> {
        *lock(&self.uptime_secs)
    }

    fn has_tpm(&self) -> bool {
        self.tpm.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_hello_signs_the_same_challenge_the_same_way() {
        let hello = FakeHello::default();
        assert_eq!(
            hello.sign("k", &[7; 32]).err(),
            Some(HelloError::KeyNotFound)
        );
        // Creating the key signs under the same prompt.
        let first = hello.enroll("k", &[7; 32]).unwrap();
        assert_eq!(hello.prompts(), 1);
        assert_eq!(first.len(), 256);
        assert_eq!(*first, *hello.sign("k", &[7; 32]).unwrap());
        assert_ne!(*first, *hello.sign("k", &[8; 32]).unwrap());

        // A new key under the same name signs differently.
        assert_ne!(*first, *hello.enroll("k", &[7; 32]).unwrap());

        hello.set_cancel(true);
        assert_eq!(hello.sign("k", &[7; 32]).err(), Some(HelloError::Cancelled));
        hello.delete("k").unwrap();
        assert!(!hello.has_key("k"));
    }

    #[test]
    fn fake_protection_is_tied_to_its_entropy() {
        let p = FakeProtection;
        let protected = p.protect(b"slot bytes", b"vault-a").unwrap();
        assert_eq!(p.unprotect(&protected, b"vault-a").unwrap(), b"slot bytes");
        assert!(p.unprotect(&protected, b"vault-b").is_err());
        assert!(p.unprotect(b"junk", b"vault-a").is_err());
    }

    #[test]
    fn clear_only_removes_our_write() {
        let cb = FakeClipboard::default();
        let ticket = cb.write_sensitive("secret").unwrap();
        cb.user_copies("mine");
        assert!(!cb.clear_if_unchanged(ticket).unwrap());
        assert_eq!(cb.text().as_deref(), Some("mine"));

        let ticket = cb.write_sensitive("secret").unwrap();
        assert!(cb.clear_if_unchanged(ticket).unwrap());
        assert_eq!(cb.text(), None);
    }
}
