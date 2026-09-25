//! Is a folder synced to a cloud service? Onboarding warns before a vault is
//! created inside one, because the sync client would upload the (encrypted)
//! vault files and break the "nothing leaves this device" promise
//! (ADR-0004 decision 3).
//!
//! Two signals, either is enough:
//! 1. The path is under a known sync root: the `OneDrive*` environment
//!    variables the OneDrive client sets, and the default Dropbox, Google
//!    Drive, iCloud and Box folders in the user profile.
//! 2. A path component is named like a sync root ("OneDrive - Contoso",
//!    "Dropbox (Personal)", "My Drive"). This catches relocated roots and
//!    Google Drive's virtual drive (`G:\My Drive`).
//!
//! A Documents folder redirected by OneDrive Known Folder Move lives under the
//! OneDrive root, so (1) already covers it; no Known Folder API call is needed.
//! This is a heuristic for a warning, not a guarantee.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CloudProvider {
    OneDrive,
    Dropbox,
    GoogleDrive,
    ICloud,
    Box,
}

#[derive(Debug, Clone, Default)]
pub struct CloudRoots {
    roots: Vec<(PathBuf, CloudProvider)>,
}

impl CloudRoots {
    pub fn new(roots: Vec<(PathBuf, CloudProvider)>) -> Self {
        Self { roots }
    }

    /// Sync roots for the current Windows user.
    pub fn from_env() -> Self {
        let mut roots = Vec::new();
        for var in ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"] {
            if let Some(p) = std::env::var_os(var).filter(|p| !p.is_empty()) {
                roots.push((PathBuf::from(p), CloudProvider::OneDrive));
            }
        }
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            for (dir, provider) in [
                ("Dropbox", CloudProvider::Dropbox),
                ("Google Drive", CloudProvider::GoogleDrive),
                ("My Drive", CloudProvider::GoogleDrive),
                ("iCloudDrive", CloudProvider::ICloud),
                ("iCloud Drive", CloudProvider::ICloud),
                ("Box", CloudProvider::Box),
            ] {
                roots.push((home.join(dir), provider));
            }
        }
        Self { roots }
    }

    /// The sync service `path` is inside, if any.
    pub fn classify(&self, path: &Path) -> Option<CloudProvider> {
        let target = lowered_components(path);
        let under_root = self.roots.iter().find_map(|(root, provider)| {
            let root = lowered_components(root);
            (!root.is_empty() && target.starts_with(&root)).then_some(*provider)
        });
        under_root.or_else(|| target.iter().find_map(|c| provider_for_component(c)))
    }
}

fn lowered_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().to_lowercase()),
            Component::Normal(n) => Some(n.to_string_lossy().to_lowercase()),
            Component::RootDir | Component::CurDir | Component::ParentDir => None,
        })
        .collect()
}

/// `name` is already lowercased.
fn provider_for_component(name: &str) -> Option<CloudProvider> {
    if name == "onedrive" || name.starts_with("onedrive - ") {
        Some(CloudProvider::OneDrive)
    } else if name == "dropbox" || name.starts_with("dropbox (") {
        Some(CloudProvider::Dropbox)
    } else if name == "google drive" || name == "my drive" || name == "shared drives" {
        Some(CloudProvider::GoogleDrive)
    } else if name == "iclouddrive" || name == "icloud drive" {
        Some(CloudProvider::ICloud)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> CloudRoots {
        CloudRoots::new(vec![
            (
                PathBuf::from(r"C:\Users\sam\OneDrive"),
                CloudProvider::OneDrive,
            ),
            (
                PathBuf::from(r"D:\Sync\Contoso Files"),
                CloudProvider::OneDrive,
            ),
            (PathBuf::from(r"C:\Users\sam\Box"), CloudProvider::Box),
        ])
    }

    fn classify(p: &str) -> Option<CloudProvider> {
        roots().classify(Path::new(p))
    }

    #[test]
    fn local_folders_are_not_cloud() {
        for p in [
            r"C:\Users\sam\AppData\Local\Vaultair\Vaults",
            r"C:\Users\sam\Documents",
            r"D:\Vaults",
            r"C:\Users\sam\OneDriveBackup",
            r"C:\Users\sam\Boxes",
            r"E:\",
        ] {
            assert_eq!(classify(p), None, "{p}");
        }
    }

    #[test]
    fn under_a_known_root() {
        assert_eq!(
            classify(r"C:\Users\sam\OneDrive\Documents\Vaults"),
            Some(CloudProvider::OneDrive)
        );
        // Case-insensitive, like Windows paths.
        assert_eq!(
            classify(r"c:\users\SAM\onedrive"),
            Some(CloudProvider::OneDrive)
        );
        // A relocated business root with no telltale name.
        assert_eq!(
            classify(r"D:\Sync\Contoso Files\Vault"),
            Some(CloudProvider::OneDrive)
        );
        assert_eq!(classify(r"C:\Users\sam\Box\v"), Some(CloudProvider::Box));
    }

    #[test]
    fn known_folder_moved_documents() {
        // KFM puts Documents under the OneDrive root.
        assert_eq!(
            classify(r"C:\Users\sam\OneDrive\Documents"),
            Some(CloudProvider::OneDrive)
        );
    }

    #[test]
    fn by_folder_name_without_env() {
        let none = CloudRoots::default();
        let c = |p: &str| none.classify(Path::new(p));
        assert_eq!(
            c(r"C:\Users\x\OneDrive - Contoso\Vaults"),
            Some(CloudProvider::OneDrive)
        );
        assert_eq!(c(r"D:\OneDrive\v"), Some(CloudProvider::OneDrive));
        assert_eq!(
            c(r"C:\Users\x\Dropbox (Personal)\v"),
            Some(CloudProvider::Dropbox)
        );
        assert_eq!(c(r"C:\Users\x\Dropbox"), Some(CloudProvider::Dropbox));
        assert_eq!(c(r"G:\My Drive\Vaults"), Some(CloudProvider::GoogleDrive));
        assert_eq!(
            c(r"C:\Users\x\Google Drive"),
            Some(CloudProvider::GoogleDrive)
        );
        assert_eq!(c(r"C:\Users\x\iCloudDrive\v"), Some(CloudProvider::ICloud));
        assert_eq!(c(r"D:\Games\Vaults"), None);
    }
}
