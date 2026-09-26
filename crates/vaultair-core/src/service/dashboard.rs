//! The dashboard's numbers, for the whole vault or one identity.
//!
//! Phase 8 covers what accounts and identities alone can answer. Health
//! counts (weak, reused, attention) join them with the health rules in
//! Phase 12.

use crate::db::repo::account as account_repo;
use crate::db::repo::identity as identity_repo;
use crate::domain::identity::DashboardSummary;
use crate::vault::OpenVault;
use crate::AppError;

const RECENT: u32 = 5;

/// Counts over active accounts. With `identity_id`, only that identity's
/// accounts count; an unknown identity is `NotFound`.
pub fn summary(vault: &OpenVault, identity_id: Option<&str>) -> Result<DashboardSummary, AppError> {
    let conn = vault.conn();
    let identities = match identity_id {
        Some(id) => {
            if identity_repo::archived(conn, id)?.is_none() {
                return Err(AppError::NotFound);
            }
            1
        }
        None => u32::try_from(identity_repo::refs(conn)?.len()).unwrap_or(u32::MAX),
    };
    let counts = account_repo::counts(conn, identity_id)?;
    Ok(DashboardSummary {
        identity_id: identity_id.map(str::to_owned),
        total_accounts: counts.total,
        main_accounts: counts.main,
        alt_accounts: counts.alt,
        identities,
        missing_mfa: counts.missing_mfa,
        favorites: counts.favorites,
        recent: account_repo::recent(conn, identity_id, RECENT)?,
    })
}
