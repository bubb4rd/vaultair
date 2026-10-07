//! Main window creation and hardening.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const MAIN: &str = "main";

/// Only the app's own origin may be loaded. Anything else (a link, a
/// redirect, an injected `location =`) is refused.
fn is_allowed_navigation(url: &Url) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        // Production asset origins on Windows (http) and other platforms (tauri://).
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("tauri", Some("localhost"), None) => true,
        // Vite dev server, debug builds only.
        ("http", Some("localhost"), Some(1420)) => cfg!(debug_assertions),
        _ => false,
    }
}

pub fn create_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Vaultair")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .decorations(false)
        .center()
        .visible(true)
        // No drag-and-drop until attachments exist (roadmap Phase 2).
        .disable_drag_drop_handler()
        .on_navigation(|url| {
            let allowed = is_allowed_navigation(url);
            if !allowed {
                tracing::warn!(scheme = url.scheme(), "blocked navigation");
            }
            allowed
        })
        .build()?;

    harden_webview(&window);
    Ok(window)
}

pub fn main(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// Brings the main window back to the front, including from the tray.
pub fn focus_main(app: &AppHandle) {
    if let Some(window) = main(app) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(windows)]
fn harden_webview(window: &tauri::WebviewWindow) {
    let release = !cfg!(debug_assertions);
    let result = window.with_webview(move |webview| {
        if let Err(err) = vaultair_platform::windows::harden_webview(&webview.controller(), release)
        {
            tracing::error!(error = %err, "webview hardening failed");
        }
    });
    if let Err(err) = result {
        tracing::error!(
            kind = %crate::logging::error_kind(&err),
            "could not access webview for hardening"
        );
    }
}

#[cfg(not(windows))]
fn harden_webview(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(s: &str) -> bool {
        is_allowed_navigation(&Url::parse(s).unwrap())
    }

    #[test]
    fn app_origins_are_allowed() {
        assert!(allowed("http://tauri.localhost/"));
        assert!(allowed("http://tauri.localhost/index.html#/accounts"));
        assert!(allowed("tauri://localhost/index.html"));
    }

    #[test]
    fn foreign_origins_are_blocked() {
        for url in [
            "https://example.com/",
            "http://tauri.localhost.evil.com/",
            "http://tauri.localhost:8080/",
            "http://localhost:1421/",
            "file:///C:/Windows/System32/",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
        ] {
            assert!(!allowed(url), "{url} should be blocked");
        }
    }

    #[test]
    fn dev_server_only_in_debug() {
        assert_eq!(allowed("http://localhost:1420/"), cfg!(debug_assertions));
    }
}
