//! Identity, contact point and dashboard commands (Phase 8). Thin: each one
//! runs the matching `vaultair_core::service` call against the unlocked
//! vault. Nothing here carries a secret.

use tauri::State;
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::domain::identity::{
    ContactPointView, DashboardSummary, IdentityDeletePlan, IdentityDetail, IdentityInput,
    IdentityOverview, IdentityRef, IdentitySummary,
};
use vaultair_core::service::{dashboard, identities};

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// Active identities, or archived ones (`archived: true`), by name.
#[tauri::command]
#[specta::specta]
pub async fn identity_list(
    state: State<'_, AppState>,
    archived: bool,
) -> IpcResult<Vec<IdentitySummary>> {
    with_vault(&state, move |v| identities::list(v, archived)).await
}

/// Active identities for pickers: the account form and the dashboard filter.
#[tauri::command]
#[specta::specta]
pub async fn identity_refs(state: State<'_, AppState>) -> IpcResult<Vec<IdentityRef>> {
    with_vault(&state, |v| identities::refs(v)).await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_get(state: State<'_, AppState>, id: String) -> IpcResult<IdentityDetail> {
    with_vault(&state, move |v| identities::get(v, &id)).await
}

/// The identity with its accounts by platform, shared emails, recovery
/// methods and recovery dependencies.
#[tauri::command]
#[specta::specta]
pub async fn identity_overview(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<IdentityOverview> {
    with_vault(&state, move |v| identities::overview(v, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_create(
    state: State<'_, AppState>,
    input: IdentityInput,
) -> IpcResult<IdentityDetail> {
    with_vault(&state, move |v| identities::create(v, &SystemClock, &input)).await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_update(
    state: State<'_, AppState>,
    id: String,
    input: IdentityInput,
) -> IpcResult<IdentityDetail> {
    with_vault(&state, move |v| {
        identities::update(v, &SystemClock, &id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_archive(state: State<'_, AppState>, id: String) -> IpcResult<IdentityDetail> {
    with_vault(&state, move |v| {
        identities::set_archived(v, &SystemClock, &id, true)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_unarchive(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<IdentityDetail> {
    with_vault(&state, move |v| {
        identities::set_archived(v, &SystemClock, &id, false)
    })
    .await
}

/// Permanently deletes an identity. `confirm_name` must be its name, as typed
/// by the user. Its accounts are kept and either move to another identity or
/// are left without one, as `plan` says.
#[tauri::command]
#[specta::specta]
pub async fn identity_delete(
    state: State<'_, AppState>,
    id: String,
    confirm_name: String,
    plan: IdentityDeletePlan,
) -> IpcResult<()> {
    with_vault(&state, move |v| {
        identities::delete(v, &id, &confirm_name, &plan)
    })
    .await
}

/// Assigns accounts to an identity in bulk (`identity_id: null` removes
/// them from theirs). Returns how many changed.
#[tauri::command]
#[specta::specta]
pub async fn identity_assign_accounts(
    state: State<'_, AppState>,
    identity_id: Option<String>,
    account_ids: Vec<String>,
) -> IpcResult<u32> {
    with_vault(&state, move |v| {
        identities::assign_accounts(v, identity_id.as_deref(), &account_ids)
    })
    .await
}

/// Every email and phone accounts and identities use, for suggestions.
#[tauri::command]
#[specta::specta]
pub async fn contact_point_list(state: State<'_, AppState>) -> IpcResult<Vec<ContactPointView>> {
    with_vault(&state, |v| identities::contacts(v)).await
}

/// The dashboard's numbers, for the whole vault or one identity.
#[tauri::command]
#[specta::specta]
pub async fn dashboard_summary(
    state: State<'_, AppState>,
    identity_id: Option<String>,
) -> IpcResult<DashboardSummary> {
    with_vault(&state, move |v| {
        dashboard::summary(v, identity_id.as_deref(), SystemClock.now_utc())
    })
    .await
}
