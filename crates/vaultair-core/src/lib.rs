//! Vaultair core: domain rules, cryptography, vault format and storage.
//!
//! This crate is pure Rust and never depends on Tauri, so the UI layer can't
//! reach around it.
#![forbid(unsafe_code)]

pub mod clock;
pub mod config;
pub mod crypto;
pub mod db;
pub mod demo;
pub mod domain;
pub mod error;
pub mod generator;
pub mod health;
pub mod redact;
pub mod search;
pub mod service;
pub mod vault;

pub use error::{AppError, ErrorCode};
pub use redact::{redact_email, redact_username, Redacted};
