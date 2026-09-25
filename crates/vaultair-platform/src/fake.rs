//! In-memory stand-ins for the OS, for tests (`feature = "fake"`).

use std::sync::{Mutex, MutexGuard};

use crate::{
    CaptureMode, CaptureProtection, Clipboard, ClipboardTicket, PlatformError, SessionEvent,
    SessionEvents, SessionSink,
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

#[cfg(test)]
mod tests {
    use super::*;

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
