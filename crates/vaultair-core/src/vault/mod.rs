//! Vault lifecycle: create, open (unlock), integrity check, close (lock).
//! See `docs/vault-format.md`.

pub mod atomic_write;
mod create;
pub mod error;
pub mod header;
pub mod layout;
pub mod lockfile;
mod open;

use std::fmt;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;

pub use create::{create_vault, CreateOptions};
pub use error::{CorruptPart, VaultError};
pub use open::open_vault;

use crate::crypto::keys::VaultKeys;
use header::VaultHeader;
use layout::VaultPaths;
use lockfile::VaultLock;

/// Non-secret facts about a vault, safe to show in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub vault_id: String,
    pub name: String,
    pub path: String,
    pub kdf_summary: String,
    pub created_at: String,
    pub demo: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub ok: bool,
}

/// An unlocked vault. Dropping it locks: the connection closes (SQLCipher
/// wipes its key), `VaultKeys` zeroizes, and the `.lock` file is released.
pub struct OpenVault {
    // Field order is drop order: close the database before wiping the keys
    // and releasing the lock.
    conn: Connection,
    keys: VaultKeys,
    header: VaultHeader,
    paths: VaultPaths,
    name: String,
    _lock: VaultLock,
}

impl fmt::Debug for OpenVault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OpenVault")
            .field("vault_id", &self.header.vault_id)
            .field("keys", &self.keys)
            .finish_non_exhaustive()
    }
}

impl OpenVault {
    pub fn info(&self) -> VaultInfo {
        VaultInfo {
            vault_id: self.header.vault_id.clone(),
            name: self.name.clone(),
            path: self.paths.dir.display().to_string(),
            kdf_summary: self.header.kdf_params().summary(),
            created_at: self.header.created_at.clone(),
            demo: self.header.demo,
        }
    }

    pub fn dir(&self) -> &PathBuf {
        &self.paths.dir
    }

    pub fn keys(&self) -> &VaultKeys {
        &self.keys
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// Verifies every page's HMAC (SQLCipher) and the SQLite structure.
    pub fn integrity_check(&self) -> Result<IntegrityReport, VaultError> {
        Ok(IntegrityReport {
            ok: crate::db::connection::integrity_ok(&self.conn)?,
        })
    }
}
