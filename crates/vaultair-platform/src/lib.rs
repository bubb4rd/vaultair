//! OS integration boundary: clipboard with history exclusion, session and
//! power events, screen-capture protection, WebView2 hardening and the native
//! folder picker.
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
