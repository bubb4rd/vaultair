//! Tauri command layer: wiring, window hardening, logging.
//! Business logic belongs in `vaultair-core`; this crate only validates,
//! maps DTOs and sanitises errors.

mod commands;
mod ipc;
mod logging;
mod window;

pub fn run() {
    let _log_guard = logging::init();

    let builder = ipc::builder();

    let result = tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window instead
        // of starting another process that could open the same vault.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            window::create_main(app.handle())?;
            Ok(())
        })
        .run(context());

    if let Err(err) = result {
        tracing::error!(error = %err, "tauri runtime exited with an error");
        std::process::exit(1);
    }
}

// `generate_context!` expands to code containing `eprintln!` (Tauri internals).
// The allowance is scoped to this function so our own code stays checked.
#[allow(clippy::disallowed_macros)]
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}
