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

/// Where a panic happened, without the build machine in it.
///
/// `Location::file()` is the path the compiler was given. For Vaultair's own
/// code that is relative to the workspace (`src-tauri/src/lock.rs`). For a
/// dependency it is absolute on whichever PC built the release (under that
/// user's `.cargo/registry/src/<index>/`), and users are invited to share
/// these logs. So: a relative path is kept; a registry path is cut down to
/// `<crate>-<version>/...`; a standard library path to what follows
/// `/rustc/<hash>/`; anything else absolute to its file name.
fn source_place(file: &str) -> String {
    let parts: Vec<&str> = file.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    let absolute = file.starts_with(['/', '\\']) || file.as_bytes().get(1) == Some(&b':');
    if !absolute {
        return parts.join("/");
    }
    let after = |at: usize| parts.get(at..).filter(|rest| !rest.is_empty());
    let registry = parts
        .windows(2)
        .rposition(|w| w[0] == "registry" && w[1] == "src")
        .and_then(|i| after(i + 3));
    let std_lib = parts
        .iter()
        .position(|p| *p == "rustc")
        .and_then(|i| after(i + 2));
    match registry.or(std_lib) {
        Some(rest) => rest.join("/"),
        None => parts.last().copied().unwrap_or("unknown").to_owned(),
    }
}

fn log_panic(info: &std::panic::PanicHookInfo<'_>) {
    match info.location() {
        Some(loc) => tracing::error!(
            file = %source_place(loc.file()),
            line = loc.line(),
            "panic"
        ),
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

    /// A panic inside a dependency reports a path on the build machine,
    /// with the builder's user name in it. None of that prefix is logged.
    #[test]
    fn a_panic_place_never_names_the_build_machine() {
        for (file, logged) in [
            (
                r"C:\Users\CANARYUSER\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tauri-2.11.6\src\app.rs",
                "tauri-2.11.6/src/app.rs",
            ),
            (
                "/home/CANARYUSER/.cargo/registry/src/index.crates.io-6f17d22bba15001f/serde_json-1.0.151/src/de.rs",
                "serde_json-1.0.151/src/de.rs",
            ),
            (
                r"/rustc/4a4ef493e3a1488c6e321570238084b38948f6db\library\core\src\option.rs",
                "library/core/src/option.rs",
            ),
            (
                r"D:\builds\CANARYUSER\vaultair\vendored\thing.rs",
                "thing.rs",
            ),
            (r"\\CANARYUSER-PC\share\x.rs", "x.rs"),
            // A git dependency isn't under the registry: file name only.
            (
                r"C:\Users\CANARYUSER\.cargo\git\checkouts\tauri-9f8e7d6c5b4a3210\1a2b3c4\core\src\lib.rs",
                "lib.rs",
            ),
            // A user called "registry" with a "src" folder is not the registry
            // layout; the real one further along still wins.
            (
                r"C:\Users\registry\src\CANARYUSER\vendored\thing\lib.rs",
                "vendored/thing/lib.rs",
            ),
            (
                r"C:\Users\registry\src\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\serde-1.0.229\src\lib.rs",
                "serde-1.0.229/src/lib.rs",
            ),
            (r"C:\Users\CANARYUSER\.cargo\registry\src", "src"),
            // Vaultair's own files are relative to the workspace already.
            (r"src-tauri\src\lock.rs", "src-tauri/src/lock.rs"),
            (
                "crates/vaultair-core/src/vault/open.rs",
                "crates/vaultair-core/src/vault/open.rs",
            ),
        ] {
            let place = source_place(file);
            assert_eq!(place, logged, "{file}");
            assert!(
                !place.contains("CANARYUSER") && !place.contains(':'),
                "{place}"
            );
        }
    }

    /// A panic message is built from whatever the failing code had in hand,
    /// so it can hold a secret or a username. The log gets the place only.
    /// This runs the hook `install_panic_hook` really installs.
    #[test]
    fn a_panic_is_logged_by_place_never_by_message() {
        let captured = Captured::default();
        let writer = captured.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .finish();

        // Install the real hook and take it back out, then send only this
        // thread's panic through it; any other test that fails meanwhile
        // still prints as usual.
        let me = std::thread::current().id();
        let previous: Arc<dyn Fn(&PanicHookInfo<'_>) + Send + Sync> =
            Arc::from(std::panic::take_hook());
        install_panic_hook();
        let installed = std::panic::take_hook();
        let fallback = previous.clone();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().id() == me {
                installed(info);
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
        // The place went through `source_place`: relative, forward slashes.
        assert!(
            logs.contains("panic") && logs.contains("file=src-tauri/src/logging.rs"),
            "{logs}"
        );
        assert!(!logs.contains("CANARY"), "{logs}");
    }
}
