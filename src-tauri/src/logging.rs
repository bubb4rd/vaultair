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
    std::panic::set_hook(Box::new(log_panic));
}

/// Which kind of Tauri error this is, for a log line: its variant name
/// ("Io", "AssetNotFound"), a fixed word. The error's own text is Tauri's,
/// not ours, and can quote a path, which can hold a Windows user name.
pub(crate) fn error_kind(err: &tauri::Error) -> String {
    let kind: String = format!("{err:?}")
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if kind.is_empty() {
        "unknown".to_owned()
    } else {
        kind
    }
}

fn log_panic(info: &std::panic::PanicHookInfo<'_>) {
    match info.location() {
        Some(loc) => tracing::error!(file = loc.file(), line = loc.line(), "panic"),
        None => tracing::error!("panic at unknown location"),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::io::Write;
    use std::panic::PanicHookInfo;
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Clone, Default)]
    struct Captured(Arc<Mutex<Vec<u8>>>);

    impl Write for Captured {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// A Tauri error is logged by its variant name. Its text, which can
    /// quote a path under the user's profile, stays out.
    #[test]
    fn a_tauri_error_is_logged_by_kind_never_by_text() {
        let path = r"C:\Users\CANARYUSER\Vaults\CANARY7F3A";
        let io = tauri::Error::Io(std::io::Error::other(path));
        assert!(io.to_string().contains("CANARYUSER"), "sanity: {io}");
        assert_eq!(error_kind(&io), "Io");
        let asset = tauri::Error::AssetNotFound(path.to_owned());
        assert_eq!(error_kind(&asset), "AssetNotFound");
        assert_eq!(
            error_kind(&tauri::Error::WebviewNotFound),
            "WebviewNotFound"
        );
    }

    /// A panic message is built from whatever the failing code had in hand,
    /// so it can hold a secret or a username. The log gets the place only.
    #[test]
    fn a_panic_is_logged_by_place_never_by_message() {
        let captured = Captured::default();
        let writer = captured.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .finish();

        // Only this thread's panic goes through the hook under test; any
        // other test that fails meanwhile still prints as usual.
        let me = std::thread::current().id();
        let previous: Arc<dyn Fn(&PanicHookInfo<'_>) + Send + Sync> =
            Arc::from(std::panic::take_hook());
        let fallback = previous.clone();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().id() == me {
                log_panic(info);
            } else {
                fallback(info);
            }
        }));
        let result = tracing::subscriber::with_default(subscriber, || {
            std::panic::catch_unwind(|| {
                panic!("password CANARY7F3A for {}", "CANARYUSER@example.com")
            })
        });
        std::panic::set_hook(Box::new(move |info| previous(info)));

        assert!(result.is_err());
        let logs = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
        assert!(
            logs.contains("panic") && logs.contains("logging.rs"),
            "{logs}"
        );
        assert!(!logs.contains("CANARY"), "{logs}");
    }
}
