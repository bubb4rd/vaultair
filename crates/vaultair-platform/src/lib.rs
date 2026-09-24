//! OS integration boundary.
//!
//! The traits are implemented in Phase 5 (clipboard exclusion formats, WTS
//! session events, display affinity, test fakes). The `windows` module already
//! holds WebView2 hardening and the native folder picker. This is the only crate where `unsafe` will be allowed,
//! and only inside its `windows` module.

use std::time::Duration;

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

/// OS events that must lock the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEvent {
    SessionLocked,
    SessionLoggedOff,
    RemoteDisconnected,
    Suspending,
    ShuttingDown,
}

pub trait SessionEvents: Send + Sync {
    /// Starts delivering events to `sink` until the returned guard is dropped.
    fn subscribe(
        &self,
        sink: Box<dyn Fn(SessionEvent) + Send + Sync>,
    ) -> Result<Box<dyn Send>, PlatformError>;
}

pub trait CaptureProtection: Send + Sync {
    /// Hides (or reveals) the app window from screen capture and streaming tools.
    fn set_excluded_from_capture(&self, excluded: bool) -> Result<(), PlatformError>;
}

/// Default timings from ADR-0004 (decision 11).
pub mod defaults {
    use super::Duration;

    pub const CLIPBOARD_CLEAR: Duration = Duration::from_secs(30);
    pub const REVEAL_HIDE: Duration = Duration::from_secs(20);
    pub const IDLE_LOCK: Duration = Duration::from_secs(5 * 60);
}
