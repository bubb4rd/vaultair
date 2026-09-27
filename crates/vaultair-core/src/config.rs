//! App config: `%LOCALAPPDATA%\Vaultair\config.json`.
//!
//! Holds only what the app needs *before* a vault is unlocked: the
//! recent-vaults list (folder paths plus when each was last opened) and the
//! screen-capture policy, which must apply to the lock screen too.
//! Never vault contents, names from inside a vault, or anything secret. See
//! docs/local-data-storage.md.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::vault::atomic_write::write_atomic;
use crate::vault::layout::HEADER_FILE;

pub const CONFIG_FILE: &str = "config.json";
const CONFIG_TMP_FILE: &str = "config.json.tmp";
pub const CONFIG_VERSION: u32 = 1;
/// Recent vaults kept, most recent first.
pub const MAX_RECENT: usize = 10;

/// `%LOCALAPPDATA%\Vaultair`, where the config file and logs live.
pub fn default_app_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| Path::new(&base).join("Vaultair"))
}

/// When the window is hidden from screenshots, streaming and screen sharing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CaptureMode {
    /// Hidden on every screen, including the lock screen. The default.
    #[default]
    Always,
    /// Visible on every screen, including the lock screen.
    Off,
    /// Visible until an account at or below [`CaptureLevel`] is open.
    Custom,
}

impl CaptureMode {
    /// Hidden at launch and whenever no qualifying account is open.
    /// Custom starts visible; the UI hides the window per account.
    pub fn hides_at_rest(self) -> bool {
        matches!(self, Self::Always)
    }
}

/// The weakest account rating that still hides the window in [`CaptureMode::Custom`].
/// Secure accounts are never hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CaptureLevel {
    /// Score under 40.
    #[default]
    Risk,
    /// Score under 70: warning and high risk.
    Warning,
    /// Score under 90: needs attention, warning and high risk.
    Attention,
}

/// The window state `capture_apply` may set. Always and Off ignore `requested`.
pub fn applied_capture(mode: CaptureMode, current: bool, requested: bool) -> bool {
    if mode == CaptureMode::Custom {
        requested
    } else {
        current
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub recent_vaults: Vec<RecentVaultEntry>,
    /// Saved policy. On (Always) unless the user changes it, including for
    /// configs written before capture protection existed (ADR-0004 decision 6).
    pub capture_mode: CaptureMode,
    /// Used when `capture_mode` is Custom. Remembered either way.
    pub capture_level: CaptureLevel,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            recent_vaults: Vec::new(),
            capture_mode: CaptureMode::Always,
            capture_level: CaptureLevel::Risk,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentVaultEntry {
    /// The vault folder (the one holding `vault.vhdr`).
    pub path: String,
    /// RFC 3339 UTC.
    pub last_opened_at: String,
}

/// A recent vault as the lock screen shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub path: String,
    /// The folder name. A vault's folder is named after it at creation, so
    /// this shows the vault's name without storing it or reading the vault.
    pub name: String,
    pub last_opened_at: String,
    /// False when the folder or its header is gone (moved, deleted, drive
    /// unplugged). The entry stays until the user removes it.
    pub available: bool,
}

/// Paths compare case-insensitively and ignore trailing separators, as
/// Windows does.
fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.trim_end_matches(['\\', '/'])
            .replace('/', "\\")
            .to_lowercase()
    };
    norm(a) == norm(b)
}

fn folder_name(path: &str) -> String {
    Path::new(path.trim_end_matches(['\\', '/']))
        .file_name()
        .map_or_else(|| path.to_owned(), |n| n.to_string_lossy().into_owned())
}

/// Loads and saves the app config. A missing or unreadable file means
/// defaults: the config only holds conveniences, so it never blocks startup.
#[derive(Debug)]
pub struct ConfigStore {
    dir: Option<PathBuf>,
    config: Mutex<AppConfig>,
}

impl ConfigStore {
    /// Loads from `dir`. `None` keeps the config in memory only (no
    /// `LOCALAPPDATA`), so the app still runs.
    pub fn load(dir: Option<PathBuf>) -> Self {
        let config = dir
            .as_deref()
            .map(|d| read_config(&d.join(CONFIG_FILE)))
            .unwrap_or_default();
        Self {
            dir,
            config: Mutex::new(config),
        }
    }

    fn guard(&self) -> MutexGuard<'_, AppConfig> {
        self.config
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn snapshot(&self) -> AppConfig {
        self.guard().clone()
    }

    /// Moves `path` to the top of the recent list.
    pub fn record_recent(&self, path: &str, now_rfc3339: &str) {
        self.update(|c| {
            c.recent_vaults.retain(|r| !same_path(&r.path, path));
            c.recent_vaults.insert(
                0,
                RecentVaultEntry {
                    path: path.to_owned(),
                    last_opened_at: now_rfc3339.to_owned(),
                },
            );
            c.recent_vaults.truncate(MAX_RECENT);
        });
    }

    /// Removes `path` from the list. Never touches the vault itself.
    pub fn forget_recent(&self, path: &str) {
        self.update(|c| c.recent_vaults.retain(|r| !same_path(&r.path, path)));
    }

    pub fn capture_mode(&self) -> CaptureMode {
        self.guard().capture_mode
    }

    pub fn capture_level(&self) -> CaptureLevel {
        self.guard().capture_level
    }

    pub fn set_capture_policy(&self, mode: CaptureMode, level: CaptureLevel) {
        self.update(|c| {
            c.capture_mode = mode;
            c.capture_level = level;
        });
    }

    pub fn recent_vaults(&self) -> Vec<RecentVault> {
        self.guard()
            .recent_vaults
            .iter()
            .map(|r| RecentVault {
                path: r.path.clone(),
                name: folder_name(&r.path),
                last_opened_at: r.last_opened_at.clone(),
                available: Path::new(&r.path).join(HEADER_FILE).is_file(),
            })
            .collect()
    }

    /// Applies `f` and saves. A failed save is logged and the in-memory
    /// change kept; losing a recent-vaults entry is not worth failing a command.
    fn update(&self, f: impl FnOnce(&mut AppConfig)) {
        let mut guard = self.guard();
        f(&mut guard);
        if let Some(dir) = &self.dir {
            if let Err(e) = write_config(dir, &guard) {
                tracing::warn!(kind = ?e.kind(), "could not save app config");
            }
        }
    }
}

/// On-disk shape. Accepts the current fields and the boolean written before
/// capture mode existed (`captureProtection`: true → Always, false → Off).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    version: u32,
    #[serde(default)]
    recent_vaults: Vec<RecentVaultEntry>,
    #[serde(default)]
    capture_protection: Option<bool>,
    #[serde(default)]
    capture_mode: Option<CaptureMode>,
    #[serde(default)]
    capture_level: Option<CaptureLevel>,
}

fn policy_from_stored(
    mode: Option<CaptureMode>,
    level: Option<CaptureLevel>,
    legacy_enabled: Option<bool>,
) -> (CaptureMode, CaptureLevel) {
    let capture_mode = mode.unwrap_or(match legacy_enabled {
        Some(false) => CaptureMode::Off,
        _ => CaptureMode::Always,
    });
    (capture_mode, level.unwrap_or_default())
}

fn read_config(path: &Path) -> AppConfig {
    let Ok(bytes) = std::fs::read(path) else {
        return AppConfig::default();
    };
    match serde_json::from_slice::<StoredConfig>(&bytes) {
        Ok(c) if c.version <= CONFIG_VERSION => {
            let (capture_mode, capture_level) =
                policy_from_stored(c.capture_mode, c.capture_level, c.capture_protection);
            AppConfig {
                version: c.version,
                recent_vaults: c.recent_vaults,
                capture_mode,
                capture_level,
            }
        }
        Ok(_) => {
            tracing::warn!("app config is from a newer version; using defaults");
            AppConfig::default()
        }
        Err(_) => {
            tracing::warn!("app config is unreadable; using defaults");
            AppConfig::default()
        }
    }
}

fn write_config(dir: &Path, config: &AppConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let bytes = serde_json::to_vec_pretty(config).map_err(std::io::Error::other)?;
    write_atomic(&dir.join(CONFIG_FILE), &dir.join(CONFIG_TMP_FILE), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ConfigStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ConfigStore::load(Some(dir.path().to_path_buf()));
        (dir, store)
    }

    #[test]
    fn missing_file_means_defaults() {
        let (_dir, store) = store();
        assert_eq!(store.snapshot(), AppConfig::default());
    }

    #[test]
    fn recent_list_persists_dedupes_and_orders_newest_first() {
        let (dir, store) = store();
        store.record_recent(r"C:\V\Main", "2026-01-01T00:00:00Z");
        store.record_recent(r"C:\V\Alts", "2026-01-02T00:00:00Z");
        // Same folder, different case and a trailing slash.
        store.record_recent(r"c:\v\main\", "2026-01-03T00:00:00Z");

        let reloaded = ConfigStore::load(Some(dir.path().to_path_buf()));
        let recent = reloaded.recent_vaults();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].name, "main");
        assert_eq!(recent[0].last_opened_at, "2026-01-03T00:00:00Z");
        assert_eq!(recent[1].name, "Alts");
    }

    #[test]
    fn recent_list_is_capped() {
        let (_dir, store) = store();
        for i in 0..(MAX_RECENT + 5) {
            store.record_recent(&format!(r"C:\V\v{i}"), "2026-01-01T00:00:00Z");
        }
        let recent = store.recent_vaults();
        assert_eq!(recent.len(), MAX_RECENT);
        assert_eq!(recent[0].name, format!("v{}", MAX_RECENT + 4));
    }

    #[test]
    fn forget_removes_only_the_entry() {
        let (_dir, store) = store();
        let vault_dir = tempfile::tempdir().unwrap();
        std::fs::write(vault_dir.path().join(HEADER_FILE), b"x").unwrap();
        let path = vault_dir.path().display().to_string();
        store.record_recent(&path, "2026-01-01T00:00:00Z");
        assert!(store.recent_vaults()[0].available);

        store.forget_recent(&path);
        assert!(store.recent_vaults().is_empty());
        assert!(vault_dir.path().join(HEADER_FILE).exists());
    }

    #[test]
    fn missing_vault_is_marked_unavailable() {
        let (_dir, store) = store();
        store.record_recent(r"Z:\does\not\exist", "2026-01-01T00:00:00Z");
        assert!(!store.recent_vaults()[0].available);
    }

    #[test]
    fn corrupt_or_newer_config_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CONFIG_FILE), b"{not json").unwrap();
        assert_eq!(
            ConfigStore::load(Some(dir.path().to_path_buf())).snapshot(),
            AppConfig::default()
        );

        std::fs::write(
            dir.path().join(CONFIG_FILE),
            br#"{"version": 99, "recentVaults": []}"#,
        )
        .unwrap();
        assert_eq!(
            ConfigStore::load(Some(dir.path().to_path_buf())).snapshot(),
            AppConfig::default()
        );
    }

    #[test]
    fn config_file_holds_paths_and_times_only() {
        let (dir, store) = store();
        store.record_recent(r"C:\V\Main", "2026-01-01T00:00:00Z");
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "version": 1,
                "recentVaults": [{ "path": r"C:\V\Main", "lastOpenedAt": "2026-01-01T00:00:00Z" }],
                "captureMode": "always",
                "captureLevel": "risk"
            })
        );
    }

    #[test]
    fn capture_policy_defaults_on_and_persists() {
        let (dir, store) = store();
        assert_eq!(store.capture_mode(), CaptureMode::Always);
        assert!(store.capture_mode().hides_at_rest());
        store.set_capture_policy(CaptureMode::Custom, CaptureLevel::Warning);
        let reloaded = ConfigStore::load(Some(dir.path().to_path_buf()));
        assert_eq!(reloaded.capture_mode(), CaptureMode::Custom);
        assert_eq!(reloaded.capture_level(), CaptureLevel::Warning);
        assert!(!reloaded.capture_mode().hides_at_rest());
    }

    #[test]
    fn legacy_capture_boolean_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let load = |json: &str| {
            std::fs::write(dir.path().join(CONFIG_FILE), json).unwrap();
            ConfigStore::load(Some(dir.path().to_path_buf()))
        };
        assert_eq!(
            load(r#"{"version":1,"recentVaults":[],"captureProtection":true}"#).capture_mode(),
            CaptureMode::Always
        );
        assert_eq!(
            load(r#"{"version":1,"recentVaults":[],"captureProtection":false}"#).capture_mode(),
            CaptureMode::Off
        );
        let both = load(
            r#"{"version":1,"recentVaults":[],"captureProtection":false,"captureMode":"custom","captureLevel":"attention"}"#,
        );
        assert_eq!(both.capture_mode(), CaptureMode::Custom);
        assert_eq!(both.capture_level(), CaptureLevel::Attention);
    }

    #[test]
    fn capture_apply_only_changes_custom_mode() {
        assert!(applied_capture(CaptureMode::Custom, false, true));
        assert!(!applied_capture(CaptureMode::Custom, true, false));
        assert!(applied_capture(CaptureMode::Always, true, false));
        assert!(!applied_capture(CaptureMode::Off, false, true));
    }

    #[test]
    fn configs_from_before_capture_protection_default_it_on() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(CONFIG_FILE),
            br#"{"version": 1, "recentVaults": []}"#,
        )
        .unwrap();
        let store = ConfigStore::load(Some(dir.path().to_path_buf()));
        assert_eq!(store.capture_mode(), CaptureMode::Always);
        assert_eq!(store.capture_level(), CaptureLevel::Risk);
    }

    #[test]
    fn works_in_memory_without_a_dir() {
        let store = ConfigStore::load(None);
        store.record_recent(r"C:\V\Main", "2026-01-01T00:00:00Z");
        assert_eq!(store.recent_vaults().len(), 1);
    }
}
