use crate::crypto::password::PolicyError;
use crate::crypto::CryptoError;
use crate::error::AppError;

/// Which part of a vault failed its integrity checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptPart {
    Header,
    Database,
}

/// Vault-level failures. Messages are static and contain no paths, input or
/// key material, so they are safe to log.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VaultError {
    #[error("no vault at that location")]
    NotFound,
    #[error("the vault header file is missing")]
    HeaderMissing,
    #[error("the vault database file is missing")]
    DatabaseMissing,
    #[error("a vault or other files already exist at that location")]
    AlreadyExists,
    #[error("the vault is open in another window or process")]
    InUse,
    #[error("the vault was created by a newer version of Vaultair")]
    TooNew,
    /// AEAD unwrap failed: wrong password, or the authenticated header fields
    /// were changed. Indistinguishable on purpose.
    #[error("wrong master password or tampered header")]
    WrongPasswordOrTampered,
    #[error("the vault is corrupted ({0:?})")]
    Corrupted(CorruptPart),
    #[error("the master password does not meet the policy: {0}")]
    WeakPassword(PolicyError),
    #[error("the vault name is not valid")]
    InvalidName,
    #[error("the vault location is not valid")]
    InvalidLocation,
    #[error("the vault is locked")]
    Locked,
    #[error("file system error ({0:?})")]
    Io(std::io::ErrorKind),
    #[error("crypto error: {0}")]
    Crypto(CryptoError),
    /// SQLite/SQLCipher failure. The primary result code only; never the message.
    #[error("database error (code {0})")]
    Database(i32),
}

impl From<std::io::Error> for VaultError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.kind())
    }
}

impl From<CryptoError> for VaultError {
    fn from(e: CryptoError) -> Self {
        Self::Crypto(e)
    }
}

impl From<rusqlite::Error> for VaultError {
    fn from(e: rusqlite::Error) -> Self {
        match e.sqlite_error_code() {
            Some(rusqlite::ErrorCode::NotADatabase) => Self::Corrupted(CorruptPart::Database),
            Some(rusqlite::ErrorCode::DatabaseCorrupt) => Self::Corrupted(CorruptPart::Database),
            _ => Self::Database(e.sqlite_error().map_or(-1, |s| s.extended_code)),
        }
    }
}

impl From<VaultError> for AppError {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::NotFound | VaultError::HeaderMissing | VaultError::DatabaseMissing => {
                Self::VaultNotFound
            }
            VaultError::AlreadyExists => Self::VaultExists,
            VaultError::InUse => Self::VaultInUse,
            VaultError::TooNew => Self::VaultTooNew,
            VaultError::WrongPasswordOrTampered => Self::WrongPassword,
            VaultError::Corrupted(_) => Self::VaultCorrupted,
            VaultError::WeakPassword(_) => Self::WeakPassword,
            VaultError::InvalidName => Self::InvalidInput { field: "name" },
            VaultError::InvalidLocation => Self::InvalidInput { field: "location" },
            VaultError::Locked => Self::VaultLocked,
            VaultError::Io(_) => Self::Internal {
                context: "file system",
            },
            VaultError::Crypto(_) => Self::Internal { context: "crypto" },
            VaultError::Database(_) => Self::Internal {
                context: "database",
            },
        }
    }
}
