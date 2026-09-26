//! The dashboard's numbers, for the whole vault or one identity.
//!
//! Account and identity counts come from those tables. Health counts and the
//! needs-attention list come from the health rules, so the dashboard and the
//! Security Health page can't disagree.

use time::OffsetDateTime;

use crate::db::repo::account as account_repo;
use crate::db::repo::identity as identity_repo;
use crate::domain::identity::DashboardSummary;
use crate::service::health;
use crate::vault::OpenVault;
use crate::AppError;

const RECENT: u32 = 5;
const ATTENTION: usize = 5;

/// Counts over active accounts. With `identity_id`, only that identity's
/// accounts count; an unknown identity is `NotFound`. `now` places the
/// dormant rule.
pub fn summary(
    vault: &OpenVault,
    identity_id: Option<&str>,
    now: OffsetDateTime,
) -> Result<DashboardSummary, AppError> {
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
    // Health checks the identity again. A missing one already returned above.
    let health = health::summary(vault, identity_id, now)?;
    let needs_attention = health::issues(vault, identity_id, None, now)?
        .into_iter()
        .take(ATTENTION)
        .collect();
    Ok(DashboardSummary {
        identity_id: identity_id.map(str::to_owned),
        total_accounts: counts.total,
        main_accounts: counts.main,
        alt_accounts: counts.alt,
        identities,
        missing_mfa: health.missing_mfa,
        favorites: counts.favorites,
        recent: account_repo::recent(conn, identity_id, RECENT)?,
        weak: health.weak,
        reused: health.reused,
        missing_recovery_codes: health.missing_recovery_codes,
        dormant: health.dormant,
        needs_attention,
    })
}
