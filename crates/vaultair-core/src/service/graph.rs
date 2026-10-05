//! The relationship map for the unlocked vault. The builder is in
//! `crate::graph`; this is what commands call.

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
