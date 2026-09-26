//! Local account health checks (Phase 12). Rules read columns that are
//! already on the account — strength, the password fingerprint, MFA, backup
//! codes, status and last activity. Nothing here decrypts a secret, and
//! nothing it returns contains one.

pub mod rules;
pub mod thresholds;

pub use rules::{dormant_predicate, high_severity_predicate, LAST_ACTIVITY};
