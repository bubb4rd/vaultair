//! Clipboard writes that Windows keeps out of clipboard history (Win+V) and
//! cloud clipboard, and a clear that only removes our own value.

use std::time::Duration;

use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::WindowsAndMessaging::IsWindow;
use zeroize::Zeroize;

use crate::{Clipboard, ClipboardTicket, PlatformError};

/// `CF_UNICODETEXT` (UTF-16, NUL-terminated).
const CF_UNICODETEXT: u32 = 13;

/// `OpenClipboard` fails while another process has the clipboard open.
/// Attempts are 5, 10, 20, 40, 80, then 100 ms apart: about 0.75 s in all.
const OPEN_ATTEMPTS: u32 = 10;

/// Writes through Vaultair's main window, which owns the clipboard
/// afterwards. The owner must be a window whose thread pumps messages
/// (Windows sends it `WM_DESTROYCLIPBOARD`), so not a hidden helper window.
#[derive(Debug, Clone, Copy)]
pub struct WindowsClipboard {
    owner: isize,
}

impl WindowsClipboard {
    /// `owner` is a raw HWND.
    pub fn new(owner: isize) -> Self {
        Self { owner }
    }
}

/// Closes the clipboard when dropped, so every early return closes it.
struct Open;

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: only constructed after OpenClipboard succeeded.
        let _ = unsafe { CloseClipboard() };
    }
}

fn open(owner: isize) -> Result<Open, PlatformError> {
    let owner = HWND(owner as *mut core::ffi::c_void);
    // At exit the window is already destroyed, and OpenClipboard with a dead
    // handle fails every time. Open without an owner then: clearing works
    // that way (only writing needs an owner).
    // SAFETY: IsWindow accepts any handle value.
    let owner = unsafe { IsWindow(Some(owner)) }.as_bool().then_some(owner);
    let mut delay = Duration::from_millis(5);
    for attempt in 0..OPEN_ATTEMPTS {
        // SAFETY: `owner` is a live window of this process, or None;
        // OpenClipboard only associates it with the open clipboard.
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return Ok(Open);
        }
        if attempt + 1 < OPEN_ATTEMPTS {
            std::thread::sleep(delay);
            delay = (delay * 2).min(Duration::from_millis(100));
        }
    }
    Err(PlatformError::ClipboardBusy)
}

/// Copies `bytes` into a movable global block and hands it to the clipboard.
///
/// # Safety
/// The clipboard must be open and emptied by this process.
unsafe fn set_data(format: u32, bytes: &[u8]) -> Result<(), PlatformError> {
    let block = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).map_err(|_| PlatformError::Os {
        context: "GlobalAlloc",
    })?;
    let ptr = GlobalLock(block).cast::<u8>();
    if ptr.is_null() {
        let _ = windows::Win32::Foundation::GlobalFree(Some(block));
        return Err(PlatformError::Os {
            context: "GlobalLock",
        });
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
    // Returns an "error" when the lock count reaches zero; that's success here.
    let _ = GlobalUnlock(block);
    if SetClipboardData(format, Some(HANDLE(block.0))).is_err() {
        // Ownership only passes to the system on success.
        let _ = windows::Win32::Foundation::GlobalFree(Some(block));
        return Err(PlatformError::Os {
            context: "SetClipboardData",
        });
    }
    Ok(())
}

impl Clipboard for WindowsClipboard {
    fn write_sensitive(&self, text: &str) -> Result<ClipboardTicket, PlatformError> {
        let mut utf16: Vec<u8> = text
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        let zero = 0u32.to_le_bytes();

        let result = (|| {
            let _open = open(self.owner)?;
            // SAFETY: the clipboard is open (guard above) and emptied first, so
            // this process owns it for the SetClipboardData calls.
            unsafe {
                EmptyClipboard().map_err(|_| PlatformError::Os {
                    context: "EmptyClipboard",
                })?;
                set_data(CF_UNICODETEXT, &utf16)?;
                // Registered formats Windows and well-behaved clipboard managers
                // honour: skip history, skip cloud sync, ignore in monitors.
                for name in [
                    w!("ExcludeClipboardContentFromMonitorProcessing"),
                    w!("CanIncludeInClipboardHistory"),
                    w!("CanUploadToCloudClipboard"),
                ] {
                    let format = RegisterClipboardFormatW(name);
                    if format == 0 {
                        return Err(PlatformError::Os {
                            context: "RegisterClipboardFormatW",
                        });
                    }
                    set_data(format, &zero)?;
                }
            }
            Ok(())
        })();
        utf16.zeroize();
        result?;

        // Read after closing: the number identifies the finished write.
        // SAFETY: no preconditions.
        let sequence = unsafe { GetClipboardSequenceNumber() };
        Ok(ClipboardTicket { sequence })
    }

    fn clear_if_unchanged(&self, ticket: ClipboardTicket) -> Result<bool, PlatformError> {
        // SAFETY: no preconditions.
        if unsafe { GetClipboardSequenceNumber() } != ticket.sequence {
            return Ok(false);
        }
        let _open = open(self.owner)?;
        // Check again now that nobody else can change it.
        // SAFETY: the clipboard is open (guard above).
        unsafe {
            if GetClipboardSequenceNumber() != ticket.sequence {
                return Ok(false);
            }
            EmptyClipboard().map_err(|_| PlatformError::Os {
                context: "EmptyClipboard",
            })?;
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use windows::core::PCWSTR;
    use windows::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
    };

    use super::*;

    fn format_present(name: PCWSTR) -> bool {
        // SAFETY: plain Win32 queries.
        unsafe { IsClipboardFormatAvailable(RegisterClipboardFormatW(name)).is_ok() }
    }

    fn clipboard_text(owner: isize) -> Option<String> {
        let _open = open(owner).unwrap();
        // SAFETY: the clipboard is open; the handle is only read while locked.
        unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
            let block = windows::Win32::Foundation::HGLOBAL(handle.0);
            let ptr = GlobalLock(block).cast::<u16>();
            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            let _ = GlobalUnlock(block);
            Some(text)
        }
    }

    /// Uses the real system clipboard, so it overwrites whatever you had
    /// copied. Run it on its own:
    /// `cargo test -p vaultair-platform -- --ignored --test-threads=1 real_clipboard`
    #[test]
    #[ignore = "touches the real clipboard"]
    fn real_clipboard_marks_and_clears_only_our_write() {
        // SAFETY: a message-only STATIC window, owned and destroyed by this test.
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("vaultair-clipboard-test"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }
        .expect("create owner window");
        let owner = hwnd.0 as isize;
        let clipboard = WindowsClipboard::new(owner);

        let ticket = clipboard.write_sensitive("vaultair-test-value").unwrap();
        assert_eq!(
            clipboard_text(owner).as_deref(),
            Some("vaultair-test-value")
        );
        assert!(format_present(w!(
            "ExcludeClipboardContentFromMonitorProcessing"
        )));
        assert!(format_present(w!("CanIncludeInClipboardHistory")));
        assert!(format_present(w!("CanUploadToCloudClipboard")));

        // A later copy (here, a second write) must not be cleared by the old ticket.
        let newer = clipboard.write_sensitive("newer").unwrap();
        assert!(!clipboard.clear_if_unchanged(ticket).unwrap());
        assert_eq!(clipboard_text(owner).as_deref(), Some("newer"));

        assert!(clipboard.clear_if_unchanged(newer).unwrap());
        assert_eq!(clipboard_text(owner), None);

        // At exit the owner window is gone before the final clear runs.
        let at_exit = clipboard.write_sensitive("at-exit").unwrap();
        // SAFETY: created above on this thread.
        unsafe { DestroyWindow(hwnd) }.expect("destroy owner window");
        assert!(clipboard.clear_if_unchanged(at_exit).unwrap());
        assert_eq!(clipboard_text(owner), None);
    }
}
