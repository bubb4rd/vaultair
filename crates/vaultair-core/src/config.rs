//! App config: `%LOCALAPPDATA%\Vaultair\config.json`.
//!
//! Holds only what the app needs *before* a vault is unlocked: the
//! recent-vaults list (folder paths plus when each was last opened) and the
//! screen-capture protection switch, which must apply to the lock screen too.
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub recent_vaults: Vec<RecentVaultEntry>,
    /// Hide the window from capture. On unless the user turns it off
    /// (ADR-0004 decision 6), including for configs written before it existed.
    #[serde(default = "default_true")]
    pub capture_protection: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            recent_vaults: Vec::new(),
            capture_protection: true,
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

    pub fn capture_protection(&self) -> bool {
        self.guard().capture_protection
    }

    pub fn set_capture_protection(&self, enabled: bool) {
        self.update(|c| c.capture_protection = enabled);
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

fn read_config(path: &Path) -> AppConfig {
    let Ok(bytes) = std::fs::read(path) else {
        return AppConfig::default();
    };
    match serde_json::from_slice::<AppConfig>(&bytes) {
        Ok(c) if c.version <= CONFIG_VERSION => c,
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
                "captureProtection": true
            })
        );
    }

    #[test]
    fn capture_protection_defaults_on_and_persists() {
        let (dir, store) = store();
        assert!(store.capture_protection());
        store.set_capture_protection(false);
        let reloaded = ConfigStore::load(Some(dir.path().to_path_buf()));
        assert!(!reloaded.capture_protection());
    }

    #[test]
    fn configs_from_before_capture_protection_default_it_on() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(CONFIG_FILE),
            br#"{"version": 1, "recentVaults": []}"#,
        )
        .unwrap();
        assert!(ConfigStore::load(Some(dir.path().to_path_buf())).capture_protection());
    }

    #[test]
    fn works_in_memory_without_a_dir() {
        let store = ConfigStore::load(None);
        store.record_recent(r"C:\V\Main", "2026-01-01T00:00:00Z");
        assert_eq!(store.recent_vaults().len(), 1);
    }
}
