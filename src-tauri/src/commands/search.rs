//! Global search, saved views and index maintenance (Phase 11). Thin: each
//! runs the matching `vaultair_core::service::search` call. Search results
//! carry what the palette shows, never a secret; secrets aren't indexed.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::search::{SavedView, SavedViewInput, SearchHit};
use vaultair_core::service::search as service;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// Accounts, identities and game profiles matching `query`, best first
/// (archived ones last). At most `limit`, capped at 50.
#[tauri::command]
#[specta::specta]
pub async fn search(
    state: State<'_, AppState>,
    query: String,
    limit: u32,
) -> IpcResult<Vec<SearchHit>> {
    with_vault(&state, move |v| service::search(v, &query, limit)).await
}

/// Rewrites the search index from the tables, for when the integrity check
/// reports it out of step. Returns the number of rows written.
#[tauri::command]
#[specta::specta]
pub async fn search_rebuild_index(state: State<'_, AppState>) -> IpcResult<u32> {
    with_vault(&state, service::rebuild_index).await
}

/// Built-in views first, then the user's, by name.
#[tauri::command]
#[specta::specta]
pub async fn saved_view_list(state: State<'_, AppState>) -> IpcResult<Vec<SavedView>> {
    with_vault(&state, |v| service::views(v)).await
}

#[tauri::command]
#[specta::specta]
pub async fn saved_view_create(
    state: State<'_, AppState>,
    input: SavedViewInput,
) -> IpcResult<SavedView> {
    with_vault(&state, move |v| {
        service::create_view(v, &SystemClock, &input)
    })
    .await
}

/// Renames a user view or replaces its filter. Built-ins can't change.
#[tauri::command]
#[specta::specta]
pub async fn saved_view_update(
    state: State<'_, AppState>,
    id: String,
    input: SavedViewInput,
) -> IpcResult<SavedView> {
    with_vault(&state, move |v| {
        service::update_view(v, &SystemClock, &id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn saved_view_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    with_vault(&state, move |v| service::delete_view(v, &id)).await
}
