//! OS integration boundary: clipboard with history exclusion, session and
//! power events, screen-capture protection, WebView2 hardening, the native
//! folder picker, and what quick unlock needs (Windows Hello keys, DPAPI,
//! TPM detection and the uptime).
//!
//! The traits keep the app layer testable: `fake` has in-memory versions. This
//! is the only crate where `unsafe` is allowed, and only inside its `windows`
//! module. Timings (clipboard clear, idle lock) are app policy and live in
//! `vaultair_core::service::session::SessionConfig`.

#[cfg(any(test, feature = "fake"))]
pub mod fake;
#[cfg(windows)]
pub mod windows;

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("the clipboard is busy")]
    ClipboardBusy,
    #[error("this feature isn't supported on this system")]
    Unsupported,
    #[error("platform call failed ({context})")]
    Os { context: &'static str },
}

/// Identifies a clipboard write so a later clear only removes *our* value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClipboardTicket {
    pub sequence: u32,
}

pub trait Clipboard: Send + Sync {
    /// Writes text marked as excluded from clipboard history and cloud clipboard.
    fn write_sensitive(&self, text: &str) -> Result<ClipboardTicket, PlatformError>;

    /// Clears the clipboard only if it still holds the write identified by `ticket`.
    /// Returns `true` if it cleared.
    fn clear_if_unchanged(&self, ticket: ClipboardTicket) -> Result<bool, PlatformError>;
}

/// OS and window events that may lock the vault. Which ones do is a setting
/// (`lock_on_*`), decided by the app layer, not here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEvent {
    /// Win+L, or the screen saver locking the session.
    SessionLocked,
    SessionLoggedOff,
    /// Console or Remote Desktop disconnect (fast user switching, RDP drop).
    Disconnected,
    /// The system is about to sleep or hibernate.
    Suspending,
    /// Shutdown, restart or sign-out is starting.
    ShuttingDown,
    /// The app window was minimized.
    Minimized,
}

pub type SessionSink = Box<dyn Fn(SessionEvent) + Send + Sync>;

pub trait SessionEvents: Send + Sync {
    /// Starts delivering events to `sink` for the life of the window.
    fn subscribe(&self, sink: SessionSink) -> Result<(), PlatformError>;
}

/// How the window is hidden from capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureMode {
    /// Capture sees nothing, as if the window weren't there (Windows 10 2004+).
    Excluded,
    /// Capture sees a black rectangle (older Windows).
    Blacked,
    /// Capture sees the window normally.
    Visible,
}

pub trait CaptureProtection: Send + Sync {
    /// Hides (or reveals) the app window from screen capture and streaming tools.
    fn set_excluded_from_capture(&self, excluded: bool) -> Result<CaptureMode, PlatformError>;
}

/// Whether Windows Hello can hold a key for this user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelloAvailability {
    Available,
    /// No PIN, fingerprint or face is set up, or policy turned Hello off.
    NotSetUp,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HelloError {
    /// The user closed the prompt, or chose to use a password instead.
    #[error("the Windows Hello prompt was cancelled")]
    Cancelled,
    #[error("Windows Hello has no key by that name")]
    KeyNotFound,
    #[error("Windows Hello failed ({context})")]
    Failed { context: &'static str },
}

/// A named Windows Hello key that signs a challenge once the user approves
/// (PIN, fingerprint or face). The private key never leaves Hello, and the
/// same challenge always gives the same signature, which is what quick
/// unlock derives its wrapping key from (ADR-0005).
///
/// `enroll` and `sign` show a prompt and block until it closes, so call
/// them from a worker thread.
pub trait QuickUnlockKey: Send + Sync {
    fn available(&self) -> HelloAvailability;
    /// Creates the key, replacing one with the same name.
    fn enroll(&self, name: &str) -> Result<(), HelloError>;
    fn sign(&self, name: &str, challenge: &[u8])
        -> Result<zeroize::Zeroizing<Vec<u8>>, HelloError>;
    /// Deletes the key. Deleting one that isn't there is not an error.
    fn delete(&self, name: &str) -> Result<(), HelloError>;
}

/// Encryption tied to the signed-in Windows user (DPAPI), with no prompt.
/// Any process running as that user can undo it, so it is only ever an
/// outer layer.
pub trait DeviceProtection: Send + Sync {
    fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError>;
    fn unprotect(&self, protected: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError>;
}

pub trait SystemInfo: Send + Sync {
    /// Seconds since Windows started, counting time asleep.
    fn uptime_secs(&self) -> Option<u64>;
    /// Whether this PC has a TPM. Asked of the TPM service itself: a
    /// working firmware TPM often can't attest, so Hello's attestation
    /// result says nothing about it.
    fn has_tpm(&self) -> bool;
}
