//! Health checks for the unlocked vault. The rules themselves are in
//! `crate::health`; this checks the identity filter and is what commands call.

use time::OffsetDateTime;

use crate::db::repo::identity as identity_repo;
use crate::domain::health::{HealthIssue, HealthRule, HealthSummary};
use crate::health::rules;
use crate::vault::OpenVault;
use crate::AppError;

fn ensure_identity(vault: &OpenVault, identity_id: Option<&str>) -> Result<(), AppError> {
    if let Some(id) = identity_id {
        if identity_repo::archived(vault.conn(), id)?.is_none() {
            return Err(AppError::NotFound);
        }
    }
    Ok(())
}

/// Counts per rule. An unknown identity is `NotFound`.
pub fn summary(
    vault: &OpenVault,
    identity_id: Option<&str>,
    now: OffsetDateTime,
) -> Result<HealthSummary, AppError> {
    ensure_identity(vault, identity_id)?;
    rules::summary(vault.conn(), identity_id, now)
}

/// Issues, highest severity first. `rule` keeps one check. An unknown
/// identity is `NotFound`.
pub fn issues(
    vault: &OpenVault,
    identity_id: Option<&str>,
    rule: Option<HealthRule>,
    now: OffsetDateTime,
) -> Result<Vec<HealthIssue>, AppError> {
    ensure_identity(vault, identity_id)?;
    rules::issues(vault.conn(), identity_id, rule, now)
}
