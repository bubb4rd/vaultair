use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use vaultair_core::config::{default_app_dir, ConfigStore};
use vaultair_core::service::session::{SessionConfig, SessionManager};
use vaultair_core::vault::location::CloudRoots;
use vaultair_core::{AppError, ErrorCode};
use vaultair_platform::{CaptureProtection, Clipboard, SessionEvent, SessionEvents};

use crate::clipboard::ClipboardService;
use crate::events::{emit, ClipboardCleared, VaultLocked};
use crate::lock::{spawn_idle_timer, Locker};

/// Managed Tauri state. Built in `setup`, once the main window exists: the
/// clipboard, capture protection and session events all hang off its HWND.
pub struct AppState {
    pub session: Arc<SessionManager>,
    pub config: Arc<ConfigStore>,
    pub cloud_roots: CloudRoots,
    pub clipboard: Arc<ClipboardService>,
    pub locker: Arc<Locker>,
    pub capture: Arc<dyn CaptureProtection>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState").finish_non_exhaustive()
    }
}

impl AppState {
    pub fn init(app: &AppHandle, window: &WebviewWindow) -> Self {
        let config = Arc::new(ConfigStore::load(default_app_dir()));
        let session = Arc::new(SessionManager::default());
        let runtime = tauri::async_runtime::handle().inner().clone();
        let platform = Platform::for_window(window);

        let handle = app.clone();
        let clipboard = ClipboardService::new(platform.clipboard, runtime.clone(), move || {
            emit(&handle, ClipboardCleared);
        });

        let capture_mode = config.capture_mode();
        let session_config = dev_overrides(SessionConfig {
            capture_mode,
            capture_level: config.capture_level(),
            capture_protection: capture_mode.hides_at_rest(),
            hide_emails: config.hide_emails(),
            ..SessionConfig::default()
        });
        let handle = app.clone();
        let capture_for_lock = platform.capture.clone();
        let locker = Arc::new(Locker::new(
            session.clone(),
            clipboard.clone(),
            session_config,
            move |enabled| apply_capture_protection(capture_for_lock.as_ref(), enabled),
            move || emit(&handle, VaultLocked),
        ));

        apply_capture_protection(platform.capture.as_ref(), session_config.capture_protection);
        watch_session_events(platform.session_events.as_ref(), &locker);
        spawn_idle_timer(locker.clone(), &runtime);

        Self {
            session,
            config,
            cloud_roots: CloudRoots::from_env(),
            clipboard,
            locker,
            capture: platform.capture,
        }
    }
}

/// Debug builds only: `VAULTAIR_DEV_IDLE_LOCK_SECS` and
/// `VAULTAIR_DEV_CLIPBOARD_CLEAR_SECS` shorten the timeouts for manual
/// testing. Release builds ignore them.
fn dev_overrides(config: SessionConfig) -> SessionConfig {
    if !cfg!(debug_assertions) {
        return config;
    }
    let secs = |name: &str| std::env::var(name).ok()?.parse::<u32>().ok();
    SessionConfig {
        idle_lock_secs: secs("VAULTAIR_DEV_IDLE_LOCK_SECS").or(config.idle_lock_secs),
        clipboard_clear_secs: secs("VAULTAIR_DEV_CLIPBOARD_CLEAR_SECS")
            .unwrap_or(config.clipboard_clear_secs),
        ..config
    }
}

pub fn apply_capture_protection(capture: &dyn CaptureProtection, enabled: bool) {
    match capture.set_excluded_from_capture(enabled) {
        Ok(mode) => tracing::info!(?mode, "capture protection applied"),
        Err(err) => tracing::warn!(error = %err, "could not set capture protection"),
    }
}

fn watch_session_events(events: &dyn SessionEvents, locker: &Arc<Locker>) {
    let locker = locker.clone();
    let result = events.subscribe(Box::new(move |event| {
        match event {
            // Finish before the system sleeps or the process is ended: lock
            // right here on the UI thread.
            SessionEvent::Suspending | SessionEvent::ShuttingDown => {
                locker.on_session_event(event);
            }
            _ => {
                let locker = locker.clone();
                tauri::async_runtime::spawn_blocking(move || locker.on_session_event(event));
            }
        }
    }));
    if let Err(err) = result {
        tracing::error!(error = %err, "could not watch session events; Win+L won't lock the vault");
    }
}

/// OS integrations for the main window.
struct Platform {
    clipboard: Arc<dyn Clipboard>,
    capture: Arc<dyn CaptureProtection>,
    session_events: Box<dyn SessionEvents>,
}

impl Platform {
    #[cfg(windows)]
    fn for_window(window: &WebviewWindow) -> Self {
        use vaultair_platform::windows::{WindowsCapture, WindowsClipboard, WindowsSessionEvents};
        let hwnd = window.hwnd().map_or(0, |h| h.0 as isize);
        Self {
            clipboard: Arc::new(WindowsClipboard::new(hwnd)),
            capture: Arc::new(WindowsCapture::new(hwnd)),
            session_events: Box::new(WindowsSessionEvents::new(hwnd)),
        }
    }

    #[cfg(not(windows))]
    fn for_window(_window: &WebviewWindow) -> Self {
        Self {
            clipboard: Arc::new(unsupported::Unsupported),
            capture: Arc::new(unsupported::Unsupported),
            session_events: Box::new(unsupported::Unsupported),
        }
    }
}

/// Vaultair targets Windows; elsewhere these features report "unsupported".
#[cfg(not(windows))]
mod unsupported {
    use vaultair_platform::{
        CaptureMode, CaptureProtection, Clipboard, ClipboardTicket, PlatformError, SessionEvents,
        SessionSink,
    };

    pub struct Unsupported;

    impl Clipboard for Unsupported {
        fn write_sensitive(&self, _: &str) -> Result<ClipboardTicket, PlatformError> {
            Err(PlatformError::Unsupported)
        }
        fn clear_if_unchanged(&self, _: ClipboardTicket) -> Result<bool, PlatformError> {
            Err(PlatformError::Unsupported)
        }
    }

    impl CaptureProtection for Unsupported {
        fn set_excluded_from_capture(&self, _: bool) -> Result<CaptureMode, PlatformError> {
            Err(PlatformError::Unsupported)
        }
    }

    impl SessionEvents for Unsupported {
        fn subscribe(&self, _: SessionSink) -> Result<(), PlatformError> {
            Err(PlatformError::Unsupported)
        }
    }
}

/// What a failed command sends to the UI: `vaultair_core::AppError` as a
/// plain DTO (`{ code, message, field? }`), with no dynamic data.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub field: Option<String>,
}

impl From<AppError> for IpcError {
    fn from(e: AppError) -> Self {
        Self {
            code: e.code(),
            message: e.user_message().to_owned(),
            field: e.field().map(str::to_owned),
        }
    }
}

pub type IpcResult<T> = Result<T, IpcError>;

/// Logs the (static, data-free) cause and converts it for the UI.
pub fn ipc_err(e: impl Into<AppError> + std::fmt::Display) -> IpcError {
    tracing::warn!(error = %e, "command failed");
    IpcError::from(e.into())
}
