//! The relationship map for the unlocked vault. The builder is in
//! `crate::graph`; this is what commands call.

use crate::clock::Clock;
use crate::db::repo::contact;
use crate::domain::graph::{Graph, GraphFocus};
use crate::graph;
use crate::vault::OpenVault;
use crate::AppError;

/// The focus and what is within `depth` steps of it, at most `limit` nodes.
/// `None` is the most allowed: depth [`graph::MAX_DEPTH`] and
/// [`graph::MAX_NODES`] nodes.
pub fn query(
    vault: &OpenVault,
    focus: &GraphFocus,
    depth: Option<u8>,
    limit: Option<u32>,
) -> Result<Graph, AppError> {
    graph::query(
        vault.conn(),
        focus,
        depth.unwrap_or(graph::MAX_DEPTH),
        limit.unwrap_or(graph::MAX_NODES),
    )
}

/// The whole vault's map, at most `limit` nodes (`None` is
/// [`graph::MAX_NODES`]).
pub fn overview(vault: &OpenVault, limit: Option<u32>) -> Result<Graph, AppError> {
    graph::overview(vault.conn(), limit.unwrap_or(graph::MAX_NODES))
}

/// Discards the prospective account the map draws for an email, or brings it
/// back. `contact_id` is the email's contact point; anything else is
/// `NotFound`.
pub fn set_prospect_dismissed(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    contact_id: &str,
    dismissed: bool,
) -> Result<(), AppError> {
    let now = clock.now_rfc3339();
    if !contact::set_mailbox_dismissed(vault.conn(), contact_id, dismissed.then_some(now.as_str()))?
    {
        return Err(AppError::NotFound);
    }
    tracing::info!(dismissed, "prospective account suggestion changed");
    Ok(())
}
