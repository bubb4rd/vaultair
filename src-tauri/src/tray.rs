//! The tray icon and close-to-tray (ADR-0005 decision 9).
//!
//! With "Keep running in the tray" on, closing the window hides it instead
//! of quitting, so the next open skips the app's startup. It saves nothing
//! else: closing still locks the vault, exactly as quitting did.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::lock::LockReason;
use crate::state::AppState;
use crate::window;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_LOCK: &str = "lock";
const MENU_QUIT: &str = "quit";

/// Adds the tray icon, shown only when `visible`. The menu has Open, Lock
/// and Quit; a left click opens the window.
pub fn create(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN, "Open Vaultair", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_LOCK, "Lock", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Vaultair")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => window::focus_main(app),
            MENU_LOCK => lock(app, LockReason::Manual),
            // `RunEvent::Exit` locks and clears the clipboard on the way out.
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::focus_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?.set_visible(visible)
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Err(err) = tray.set_visible(visible) {
        tracing::warn!(error = %err, "could not change the tray icon");
    }
}

/// Locking can wait on a busy clipboard, so it runs off the UI thread.
fn lock(app: &AppHandle, reason: LockReason) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let locker = state.locker.clone();
    tauri::async_runtime::spawn_blocking(move || locker.lock(reason));
}

/// Handles a close request. Returns true if the window was hidden to the
/// tray instead, in which case the caller cancels the close.
pub fn close_to_tray(app: &AppHandle) -> bool {
    let keep = app
        .try_state::<AppState>()
        .is_some_and(|state| state.config.keep_in_tray());
    // Without a tray icon there would be no way back to a hidden window.
    if !keep || app.tray_by_id(TRAY_ID).is_none() {
        return false;
    }
    let Some(main) = window::main(app) else {
        return false;
    };
    if main.hide().is_err() {
        return false;
    }
    lock(app, LockReason::Tray);
    tracing::info!("window closed to the tray");
    true
}
