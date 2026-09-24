use std::sync::Arc;

use serde::Serialize;
use vaultair_core::config::{default_app_dir, ConfigStore};
use vaultair_core::service::session::SessionManager;
use vaultair_core::vault::location::CloudRoots;
use vaultair_core::{AppError, ErrorCode};

/// Managed Tauri state.
#[derive(Debug)]
pub struct AppState {
    pub session: Arc<SessionManager>,
    pub config: Arc<ConfigStore>,
    pub cloud_roots: CloudRoots,
}

impl AppState {
    pub fn load() -> Self {
        Self {
            session: Arc::default(),
            config: Arc::new(ConfigStore::load(default_app_dir())),
            cloud_roots: CloudRoots::from_env(),
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
