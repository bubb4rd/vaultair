//! File logging and the panic hook.
//!
//! Logs go to `%LOCALAPPDATA%\Vaultair\logs`, INFO and above, one file per day,
//! seven files kept. Nothing is written to stdout/stderr. Log call sites must
//! never pass secrets, and must pass usernames/emails through
//! `vaultair_core::redact_*`.

use std::path::PathBuf;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};

const MAX_LOG_FILES: usize = 7;

pub(crate) fn log_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("Vaultair").join("logs"))
}

/// Starts file logging. Returns a guard that must live until shutdown so
/// buffered lines are flushed. If the log folder can't be created, the app
/// runs without logging rather than failing to start.
pub fn init() -> Option<WorkerGuard> {
    install_panic_hook();

    let dir = log_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("vaultair")
        .filename_suffix("log")
        .max_log_files(MAX_LOG_FILES)
        .build(&dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);

    tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true)
        .with_max_level(tracing::Level::INFO)
        .try_init()
        .ok()?;

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "vaultair started");
    Some(guard)
}

/// Logs where a panic happened, never its payload: a payload can be built
/// from formatted values that include user data.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| match info.location() {
        Some(loc) => tracing::error!(file = loc.file(), line = loc.line(), "panic"),
        None => tracing::error!("panic at unknown location"),
    }));
}
