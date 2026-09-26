//! Global search and the account list's filters (Phase 11, plan §3.1).
//!
//! - `filters`: the versioned filter language, validated and compiled to SQL.
//! - `query`: text queries against the FTS5 trigram index.
//! - `index`: rebuilding the index and checking it against the tables.
//!
//! The index never holds a secret: passwords, sensitive notes, secret custom
//! fields, MFA data and fingerprints are left out when rows are written
//! (`repo::*::reindex`), and a canary test checks it.

pub mod filters;
pub mod index;
pub mod query;

pub use filters::{AccountFilter, AccountSort, SortKey, StatusFilter, ViewSpec};
