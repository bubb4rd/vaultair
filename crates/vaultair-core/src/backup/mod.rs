//! Encrypted backups: one `*.vaultair-backup` file holding a vault's header
//! and database, with a MAC over the whole file. See `docs/backup-restore.md`.
//!
//! A backup opens with the master password the vault had when the backup was
//! made. Nothing here writes vault data in plaintext: the database is copied
//! as SQLCipher pages and only ever opened with the vault's keys.

pub mod container;
mod create;
mod restore;
mod verify;

pub use container::EXTENSION;
pub use create::{create_backup, BackupFile};
pub use restore::{restore_backup, RestoreOptions};
pub use verify::{inspect_backup, verify_backup, BackupInfo};
