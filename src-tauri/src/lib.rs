//! Tauri command layer: wiring, window hardening, logging.
//! Business logic belongs in `vaultair-core`; this crate only validates,
//! maps DTOs and sanitises errors.

mod clipboard;
mod commands;
mod events;
mod ipc;
mod lock;
mod logging;
mod state;
mod window;

use tauri::{Manager, RunEvent};

pub fn run() {
    let _log_guard = logging::init();

    let builder = ipc::builder();

    let app = tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window instead
        // of starting another process that could open the same vault.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let window = window::create_main(app.handle())?;
            // Commands can only arrive once the page loads, after setup returns,
            // so managing state here (it needs the window) is early enough.
            app.manage(state::AppState::init(app.handle(), &window));
            Ok(())
        })
        .build(context());

    let app = match app {
        Ok(app) => app,
        Err(err) => {
            tracing::error!(error = %err, "tauri failed to start");
            std::process::exit(1);
        }
    };

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // Close the vault and take our value off the clipboard on the way out.
            if let Some(state) = app.try_state::<state::AppState>() {
                state.locker.lock(lock::LockReason::Exit);
            }
        }
    });
}

// `generate_context!` expands to code containing `eprintln!` (Tauri internals).
// The allowance is scoped to this function so our own code stays checked.
#[allow(clippy::disallowed_macros)]
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}
