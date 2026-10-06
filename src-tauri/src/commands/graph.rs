//! The relationship map (Phase 13). Thin: each command runs the matching
//! `vaultair_core::service::graph` call. Nodes name records and edges name
//! links. Passwords, secrets and strength scores stay in the database.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::graph::{Graph, GraphFocus};
use vaultair_core::service::graph as service;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// The focus and what is within `depth` steps of it, at most `limit` nodes.
/// Null `depth` or `limit` is the most allowed (2 steps, 300 nodes); more
/// than that is `invalid_input`. An unknown focus is `not_found`.
#[tauri::command]
#[specta::specta]
pub async fn graph_query(
    state: State<'_, AppState>,
    focus: GraphFocus,
    depth: Option<u8>,
    limit: Option<u32>,
) -> IpcResult<Graph> {
    with_vault(&state, move |v| service::query(v, &focus, depth, limit)).await
}

/// The whole vault as one map: a tree under every identity, then one under
/// each email and account no identity reaches. Null `limit` is the most
/// allowed (300 nodes); `truncated` says when the vault holds more.
#[tauri::command]
#[specta::specta]
pub async fn graph_overview(state: State<'_, AppState>, limit: Option<u32>) -> IpcResult<Graph> {
    with_vault(&state, move |v| service::overview(v, limit)).await
}

/// Discards the prospective account drawn for an email (`dismissed: true`),
/// or brings it back. `contact_id` is the email's contact point; anything
/// else is `not_found`.
#[tauri::command]
#[specta::specta]
pub async fn graph_prospect_set_dismissed(
    state: State<'_, AppState>,
    contact_id: String,
    dismissed: bool,
) -> IpcResult<()> {
    with_vault(&state, move |v| {
        service::set_prospect_dismissed(v, &SystemClock, &contact_id, dismissed)
    })
    .await
}
