//! The relationship map (Phase 13). Thin: the command runs
//! `vaultair_core::service::graph::query`. Nodes name records and edges name
//! links. Passwords, secrets and strength scores stay in the database.

use tauri::State;
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
