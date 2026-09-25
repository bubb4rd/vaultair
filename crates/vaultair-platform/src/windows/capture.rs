//! Screen-capture protection via window display affinity.

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WDA_NONE,
    WINDOW_DISPLAY_AFFINITY,
};

use crate::{CaptureMode, CaptureProtection, PlatformError};

/// Hides a top-level window from BitBlt, Desktop Duplication and
/// Windows.Graphics.Capture: screenshot tools, OBS and Discord streaming,
/// and Recall snapshots. It doesn't stop an attacker with code running on
/// the machine.
#[derive(Debug, Clone, Copy)]
pub struct WindowsCapture {
    hwnd: isize,
}

impl WindowsCapture {
    /// `hwnd` is the app's raw top-level window handle.
    pub fn new(hwnd: isize) -> Self {
        Self { hwnd }
    }

    fn set(&self, affinity: WINDOW_DISPLAY_AFFINITY) -> windows::core::Result<()> {
        // SAFETY: `hwnd` is a live top-level window of this process.
        unsafe { SetWindowDisplayAffinity(HWND(self.hwnd as *mut core::ffi::c_void), affinity) }
    }
}

impl CaptureProtection for WindowsCapture {
    fn set_excluded_from_capture(&self, excluded: bool) -> Result<CaptureMode, PlatformError> {
        let failed = |_| PlatformError::Os {
            context: "SetWindowDisplayAffinity",
        };
        if !excluded {
            return self
                .set(WDA_NONE)
                .map(|()| CaptureMode::Visible)
                .map_err(failed);
        }
        // WDA_EXCLUDEFROMCAPTURE needs Windows 10 2004. Older builds reject it;
        // WDA_MONITOR still keeps the contents out of captures (as black).
        match self.set(WDA_EXCLUDEFROMCAPTURE) {
            Ok(()) => Ok(CaptureMode::Excluded),
            Err(_) => self
                .set(WDA_MONITOR)
                .map(|()| CaptureMode::Blacked)
                .map_err(failed),
        }
    }
}
