//! Vaultair core: domain rules, cryptography, vault format and storage.
//!
//! This crate is pure Rust and never depends on Tauri, so the UI layer can't
//! reach around it. Crypto, vault and database modules arrive in Phase 3.
#![forbid(unsafe_code)]

pub mod error;
pub mod redact;

pub use error::{AppError, ErrorCode};
pub use redact::{redact_email, redact_username, Redacted};
