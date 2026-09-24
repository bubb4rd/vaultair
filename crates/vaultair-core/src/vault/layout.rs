//! Where a vault's files live. A vault is a folder (ADR-0003).

use std::path::{Path, PathBuf};

pub const HEADER_FILE: &str = "vault.vhdr";
pub const DB_FILE: &str = "vault.vdb";
pub const HEADER_PREV_FILE: &str = "vault.vhdr.prev";
pub const HEADER_TMP_FILE: &str = "vault.vhdr.tmp";
pub const LOCK_FILE: &str = ".lock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultPaths {
    pub dir: PathBuf,
    pub header: PathBuf,
    pub db: PathBuf,
    pub header_prev: PathBuf,
    pub header_tmp: PathBuf,
    pub lock: PathBuf,
}

impl VaultPaths {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        let dir = dir.into();
        Self {
            header: dir.join(HEADER_FILE),
            db: dir.join(DB_FILE),
            header_prev: dir.join(HEADER_PREV_FILE),
            header_tmp: dir.join(HEADER_TMP_FILE),
            lock: dir.join(LOCK_FILE),
            dir,
        }
    }
}

/// `%LOCALAPPDATA%\Vaultair\Vaults` (ADR-0004 decision 3). Not Documents,
/// which is often synced to OneDrive.
pub fn default_vaults_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| Path::new(&base).join("Vaultair").join("Vaults"))
}

/// Vault names become folder names. Allows letters, digits, spaces and
/// `- _ . ( )`, 1–64 characters, no leading/trailing space or dot, and not a
/// Windows reserved device name.
pub fn validate_name(name: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let len = name.chars().count();
    (1..=64).contains(&len)
        && name.trim() == name
        && !name.ends_with('.')
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')'))
        && !RESERVED.contains(
            &name
                .split('.')
                .next()
                .unwrap_or(name)
                .to_ascii_uppercase()
                .as_str(),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        for ok in ["Main vault", "alts_2026", "Gaming (EU)", "Vault.v2", "Ærø"] {
            assert!(validate_name(ok), "{ok}");
        }
        for bad in [
            "",
            " lead",
            "trail ",
            "..",
            ".hidden",
            "dot.",
            "a/b",
            "a\\b",
            "C:",
            "con",
            "LPT1.txt",
            "star*",
            "q?",
            "<x>",
            "pipe|",
            &"x".repeat(65),
        ] {
            assert!(!validate_name(bad), "{bad}");
        }
    }
}
