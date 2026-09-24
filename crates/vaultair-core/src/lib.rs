//! Vaultair core: domain rules, cryptography, vault format and storage.
//!
//! This crate is pure Rust and never depends on Tauri, so the UI layer can't
//! reach around it.
#![forbid(unsafe_code)]

pub mod clock;
pub mod crypto;
pub mod db;
pub mod error;
pub mod redact;
pub mod service;
pub mod vault;

pub use error::{AppError, ErrorCode};
pub use redact::{redact_email, redact_username, Redacted};
