//! Purpose label commands (Phase 9). Thin: each one runs the matching
//! `vaultair_core::service::purposes` call against the unlocked vault.
//! Listing stays `account::purpose_list`. Nothing here carries a secret.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::account::{PurposeInput, PurposeView};
use vaultair_core::service::purposes;

use super::with_vault;
use crate::state::{AppState, IpcResult};

#[tauri::command]
#[specta::specta]
pub async fn purpose_create(
    state: State<'_, AppState>,
    input: PurposeInput,
) -> IpcResult<PurposeView> {
    with_vault(&state, move |v| purposes::create(v, &SystemClock, &input)).await
}

/// Renames and recolours. Built-ins only recolour.
#[tauri::command]
#[specta::specta]
pub async fn purpose_update(
    state: State<'_, AppState>,
    id: String,
    input: PurposeInput,
) -> IpcResult<PurposeView> {
    with_vault(&state, move |v| {
        purposes::update(v, &SystemClock, &id, &input)
    })
    .await
}

/// Hides a label from new picks, or shows it again.
#[tauri::command]
#[specta::specta]
pub async fn purpose_set_hidden(
    state: State<'_, AppState>,
    id: String,
    hidden: bool,
) -> IpcResult<PurposeView> {
    with_vault(&state, move |v| {
        purposes::set_hidden(v, &SystemClock, &id, hidden)
    })
    .await
}

/// `ids` is every label, in the new order.
#[tauri::command]
#[specta::specta]
pub async fn purpose_reorder(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> IpcResult<Vec<PurposeView>> {
    with_vault(&state, move |v| purposes::reorder(v, &ids)).await
}

/// Deletes a custom label, moving its accounts to `reassign_to` first.
#[tauri::command]
#[specta::specta]
pub async fn purpose_delete(
    state: State<'_, AppState>,
    id: String,
    reassign_to: Option<String>,
) -> IpcResult<()> {
    with_vault(&state, move |v| {
        purposes::delete(v, &SystemClock, &id, reassign_to.as_deref())
    })
    .await
}
