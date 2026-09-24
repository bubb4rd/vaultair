//! Windows implementations. All `unsafe` in Vaultair lives in this module.
#![allow(unsafe_code)]

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings3, ICoreWebView2Settings4,
    ICoreWebView2Settings5, ICoreWebView2Settings6,
};
use windows::core::Interface;

use crate::PlatformError;

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
