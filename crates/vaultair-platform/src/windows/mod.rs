//! Windows implementations. All `unsafe` in Vaultair lives in this module.
#![allow(unsafe_code)]

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings3, ICoreWebView2Settings4,
    ICoreWebView2Settings5, ICoreWebView2Settings6,
};
use windows::core::Interface;

use crate::PlatformError;

mod capture;
mod clipboard;
mod session;

pub use capture::WindowsCapture;
pub use clipboard::WindowsClipboard;
pub use session::WindowsSessionEvents;

fn os(context: &'static str) -> impl FnOnce(windows::core::Error) -> PlatformError {
    move |_| PlatformError::Os { context }
}

/// Locks down WebView2 browser features Vaultair never needs.
///
/// Always: no password autosave or form autofill (they would store what users
/// type outside the vault), no status bar, zoom, pinch or swipe navigation,
/// no host objects, no built-in error pages.
/// Release only (`release = true`): no devtools, default context menu, or
/// browser accelerator keys (F5, Ctrl+P, Ctrl+F, Ctrl+Shift+I). Clipboard
/// shortcuts keep working.
pub fn harden_webview(
    controller: &ICoreWebView2Controller,
    release: bool,
) -> Result<(), PlatformError> {
    let debug = !release;
    // SAFETY: plain COM calls on interfaces owned by the live WebView2
    // controller, made on the thread `with_webview` runs us on (the UI thread).
    unsafe {
        let core = controller.CoreWebView2().map_err(os("CoreWebView2"))?;
        let settings = core.Settings().map_err(os("Settings"))?;

        settings
            .SetAreDevToolsEnabled(debug)
            .map_err(os("devtools"))?;
        settings
            .SetAreDefaultContextMenusEnabled(debug)
            .map_err(os("context menu"))?;
        settings
            .SetIsStatusBarEnabled(false)
            .map_err(os("status bar"))?;
        settings
            .SetIsZoomControlEnabled(false)
            .map_err(os("zoom"))?;
        settings
            .SetAreHostObjectsAllowed(false)
            .map_err(os("host objects"))?;
        settings
            .SetIsBuiltInErrorPageEnabled(false)
            .map_err(os("error page"))?;

        let s3: ICoreWebView2Settings3 = settings.cast().map_err(os("Settings3"))?;
        s3.SetAreBrowserAcceleratorKeysEnabled(debug)
            .map_err(os("accelerator keys"))?;

        let s4: ICoreWebView2Settings4 = settings.cast().map_err(os("Settings4"))?;
        s4.SetIsPasswordAutosaveEnabled(false)
            .map_err(os("password autosave"))?;
        s4.SetIsGeneralAutofillEnabled(false)
            .map_err(os("autofill"))?;

        let s5: ICoreWebView2Settings5 = settings.cast().map_err(os("Settings5"))?;
        s5.SetIsPinchZoomEnabled(false).map_err(os("pinch zoom"))?;

        let s6: ICoreWebView2Settings6 = settings.cast().map_err(os("Settings6"))?;
        s6.SetIsSwipeNavigationEnabled(false)
            .map_err(os("swipe navigation"))?;
    }
    Ok(())
}

/// Opens an `http(s)://` URL in the user's default browser.
///
/// The caller (vaultair-core) has already validated the URL; this re-checks
/// the scheme and the character set as a last line of defence, because
/// `ShellExecuteW` will happily run anything it's given a handler for
/// (`file:`, `ms-settings:`, executables). Blocks briefly; call it off the
/// UI thread.
pub fn open_url(url: &str) -> Result<(), PlatformError> {
    use windows::core::{w, HSTRING};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            // SAFETY: only constructed after CoInitializeEx succeeded on this thread.
            unsafe { CoUninitialize() };
        }
    }

    if !is_openable_url(url) {
        return Err(PlatformError::Os {
            context: "url rejected",
        });
    }

    // SAFETY: ShellExecuteW with the "open" verb and a validated URL; no
    // parameters or working directory are passed. COM is initialized on this
    // thread first, as the ShellExecute documentation asks.
    unsafe {
        let _com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            .ok()
            .ok()
            .map(|()| ComGuard);
        let result = ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            None,
            None,
            SW_SHOWNORMAL,
        );
        // Values above 32 mean success (a legacy HINSTANCE convention).
        if result.0 as isize > 32 {
            Ok(())
        } else {
            Err(PlatformError::Os {
                context: "ShellExecuteW",
            })
        }
    }
}

/// Opens a folder in File Explorer. Only for folders Vaultair chose itself
/// (the logs folder); the path must be absolute and an existing directory,
/// so `ShellExecuteW` can't be pointed at a file or program.
pub fn open_folder(dir: &std::path::Path) -> Result<(), PlatformError> {
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if !dir.is_absolute() || !dir.is_dir() {
        return Err(PlatformError::Os {
            context: "folder rejected",
        });
    }
    // SAFETY: ShellExecuteW with the "explore" verb on a checked directory;
    // no parameters or working directory are passed.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("explore"),
            &HSTRING::from(dir.as_os_str()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(PlatformError::Os {
            context: "ShellExecuteW",
        })
    }
}

/// `http://` or `https://`, then only printable ASCII that can't break out
/// of a command line or look like a path.
fn is_openable_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && url.chars().all(|c| {
            c.is_ascii_graphic()
                && !matches!(c, '"' | '<' | '>' | '\\' | '^' | '`' | '{' | '|' | '}')
        })
}

/// Shows the system "choose a folder" dialog, modal to `owner` (a raw HWND).
/// Returns `None` if the user cancels. Blocks until the dialog closes, so call
/// it from a worker thread, not the UI thread.
///
/// This replaces `tauri-plugin-dialog`, which pulls in `tauri-plugin-fs`
/// (banned in deny.toml). The webview never gets a file-system API: Rust shows
/// the dialog and validates the chosen path itself.
pub fn pick_folder(
    owner: isize,
    title: &str,
    initial: Option<&std::path::Path>,
) -> Result<Option<std::path::PathBuf>, PlatformError> {
    pick(owner, title, initial, None)
}

/// The same dialog for one existing file. `file_type` is a label and a
/// pattern, such as `("Vaultair backups", "*.vaultair-backup")`.
pub fn pick_file(
    owner: isize,
    title: &str,
    initial: Option<&std::path::Path>,
    file_type: (&str, &str),
) -> Result<Option<std::path::PathBuf>, PlatformError> {
    pick(owner, title, initial, Some(file_type))
}

/// Folders when `file_type` is `None`, otherwise files of that type.
fn pick(
    owner: isize,
    title: &str,
    initial: Option<&std::path::Path>,
    file_type: Option<(&str, &str)>,
) -> Result<Option<std::path::PathBuf>, PlatformError> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
        FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST,
        FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    /// Balances a successful `CoInitializeEx` on this thread.
    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            // SAFETY: only constructed after CoInitializeEx succeeded on this thread.
            unsafe { CoUninitialize() };
        }
    }

    // SAFETY: standard IFileOpenDialog usage. Every COM object is created, used
    // and released on this thread, inside a COM apartment this function owns.
    // `owner` is only passed through as the dialog's parent window.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            .ok()
            .map_err(os("CoInitializeEx"))?;
        let _com = ComGuard;

        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(os("FileOpenDialog"))?;
        let options = dialog.GetOptions().map_err(os("GetOptions"))?;
        let what = if file_type.is_some() {
            FOS_FILEMUSTEXIST
        } else {
            FOS_PICKFOLDERS
        };
        dialog
            .SetOptions(options | what | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR)
            .map_err(os("SetOptions"))?;
        if let Some((label, pattern)) = file_type {
            // Both strings outlive the call, which copies them.
            let (label, pattern) = (HSTRING::from(label), HSTRING::from(pattern));
            dialog
                .SetFileTypes(&[COMDLG_FILTERSPEC {
                    pszName: PCWSTR(label.as_ptr()),
                    pszSpec: PCWSTR(pattern.as_ptr()),
                }])
                .map_err(os("SetFileTypes"))?;
        }
        dialog
            .SetTitle(&HSTRING::from(title))
            .map_err(os("SetTitle"))?;
        if let Some(dir) = initial.filter(|d| d.is_dir()) {
            let wide: Vec<u16> = dir.as_os_str().encode_wide().chain([0]).collect();
            if let Ok(item) =
                SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(wide.as_ptr()), None)
            {
                let _ = dialog.SetFolder(&item);
            }
        }

        match dialog.Show(Some(HWND(owner as *mut core::ffi::c_void))) {
            Ok(()) => {}
            Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => return Ok(None),
            Err(_) => return Err(PlatformError::Os { context: "Show" }),
        }

        let item = dialog.GetResult().map_err(os("GetResult"))?;
        let raw = item
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(os("GetDisplayName"))?;
        let path = std::ffi::OsString::from_wide(raw.as_wide());
        CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void));
        Ok(Some(path.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::is_openable_url;

    #[test]
    fn only_plain_web_urls_are_opened() {
        assert!(is_openable_url("https://example.com/login?next=/home#top"));
        assert!(is_openable_url("HTTP://example.com"));
        for bad in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            r"C:\Windows\System32\calc.exe",
            "https://example.com/\" --new-window file:///c:",
            "https://example.com/ space",
            "https://exämple.com",
            "",
        ] {
            assert!(!is_openable_url(bad), "{bad}");
        }
    }
}
