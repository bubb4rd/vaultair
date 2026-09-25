//! Session and power events, read by subclassing the app's main window.
//!
//! A real top-level window is used rather than a message-only one: WTS
//! notifications to `HWND_MESSAGE` windows are unreliable.

use std::panic::{catch_unwind, AssertUnwindSafe};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    PBT_APMSUSPEND, SIZE_MINIMIZED, WM_NCDESTROY, WM_POWERBROADCAST, WM_QUERYENDSESSION, WM_SIZE,
    WM_WTSSESSION_CHANGE, WTS_CONSOLE_DISCONNECT, WTS_REMOTE_DISCONNECT, WTS_SESSION_LOCK,
    WTS_SESSION_LOGOFF,
};

use crate::{PlatformError, SessionEvent, SessionEvents, SessionSink};

/// Arbitrary, unique among this window's subclasses.
const SUBCLASS_ID: usize = 0x5641_554C; // "VAUL"

#[derive(Debug, Clone, Copy)]
pub struct WindowsSessionEvents {
    hwnd: isize,
}

impl WindowsSessionEvents {
    /// `hwnd` is the app's raw top-level window handle.
    pub fn new(hwnd: isize) -> Self {
        Self { hwnd }
    }
}

impl SessionEvents for WindowsSessionEvents {
    /// Must be called once, on the thread that owns the window (the UI
    /// thread). Everything is released when the window is destroyed.
    fn subscribe(&self, sink: SessionSink) -> Result<(), PlatformError> {
        let hwnd = HWND(self.hwnd as *mut core::ffi::c_void);
        let data = Box::into_raw(Box::new(sink));
        // SAFETY: `data` stays valid until WM_NCDESTROY, where the subclass
        // proc removes itself and frees it. Called on the window's own thread.
        unsafe {
            if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, data as usize).as_bool() {
                drop(Box::from_raw(data));
                return Err(PlatformError::Os {
                    context: "SetWindowSubclass",
                });
            }
            if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION).is_err() {
                let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
                drop(Box::from_raw(data));
                return Err(PlatformError::Os {
                    context: "WTSRegisterSessionNotification",
                });
            }
        }
        Ok(())
    }
}

/// Maps a window message to the event it signals, if any.
fn event_for(msg: u32, wparam: usize) -> Option<SessionEvent> {
    let w = u32::try_from(wparam).ok();
    match (msg, w) {
        (WM_WTSSESSION_CHANGE, Some(WTS_SESSION_LOCK)) => Some(SessionEvent::SessionLocked),
        (WM_WTSSESSION_CHANGE, Some(WTS_SESSION_LOGOFF)) => Some(SessionEvent::SessionLoggedOff),
        (WM_WTSSESSION_CHANGE, Some(WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT)) => {
            Some(SessionEvent::Disconnected)
        }
        (WM_POWERBROADCAST, Some(PBT_APMSUSPEND)) => Some(SessionEvent::Suspending),
        (WM_QUERYENDSESSION, _) => Some(SessionEvent::ShuttingDown),
        (WM_SIZE, Some(SIZE_MINIMIZED)) => Some(SessionEvent::Minimized),
        _ => None,
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    let sink = data as *mut SessionSink;
    if msg == WM_NCDESTROY {
        // SAFETY: last message this window gets; `sink` came from
        // Box::into_raw in `subscribe` and nothing uses it after this.
        unsafe {
            let _ = WTSUnRegisterSessionNotification(hwnd);
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            drop(Box::from_raw(sink));
        }
    } else if let Some(event) = event_for(msg, wparam.0) {
        // A panic must not unwind into Windows (that aborts the process).
        // SAFETY: `sink` is valid until WM_NCDESTROY (see `subscribe`).
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe { (*sink)(event) }));
    }
    // Always pass the message on: default handling must still happen (for
    // example WM_QUERYENDSESSION must still answer "OK to end").
    // SAFETY: forwarding the unchanged message to the next handler.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_lock_triggers() {
        let wts = |code: u32| event_for(WM_WTSSESSION_CHANGE, code as usize);
        assert_eq!(wts(WTS_SESSION_LOCK), Some(SessionEvent::SessionLocked));
        assert_eq!(
            wts(WTS_SESSION_LOGOFF),
            Some(SessionEvent::SessionLoggedOff)
        );
        assert_eq!(
            wts(WTS_CONSOLE_DISCONNECT),
            Some(SessionEvent::Disconnected)
        );
        assert_eq!(wts(WTS_REMOTE_DISCONNECT), Some(SessionEvent::Disconnected));
        // WTS_SESSION_UNLOCK (8) and WTS_CONSOLE_CONNECT (1) aren't lock triggers.
        assert_eq!(wts(8), None);
        assert_eq!(wts(1), None);

        assert_eq!(
            event_for(WM_POWERBROADCAST, PBT_APMSUSPEND as usize),
            Some(SessionEvent::Suspending)
        );
        // PBT_APMRESUMEAUTOMATIC (18)
        assert_eq!(event_for(WM_POWERBROADCAST, 18), None);
        assert_eq!(
            event_for(WM_QUERYENDSESSION, 0),
            Some(SessionEvent::ShuttingDown)
        );
        assert_eq!(
            event_for(WM_SIZE, SIZE_MINIMIZED as usize),
            Some(SessionEvent::Minimized)
        );
        // SIZE_RESTORED (0), SIZE_MAXIMIZED (2)
        assert_eq!(event_for(WM_SIZE, 0), None);
        assert_eq!(event_for(WM_SIZE, 2), None);
    }
}
