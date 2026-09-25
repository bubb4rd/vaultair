//! Encrypted storage (SQLCipher): connection setup, migrations and the
//! per-table repositories.

pub mod connection;
pub mod migrate;
pub mod repo;
