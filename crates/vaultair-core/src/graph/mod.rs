//! The relationship map (Phase 13): which identities, emails, accounts,
//! platforms, games, MFA methods and recovery methods are connected. Built
//! from ids, names and links only. Nothing here decrypts a secret, and
//! nothing it returns contains one.

pub mod builder;

pub use builder::{overview, query, MAX_DEPTH, MAX_NODES};
