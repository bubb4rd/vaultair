//! Account commands (Phase 7). Thin: each one runs the matching
//! `vaultair_core::service::accounts` call against the unlocked vault. The
//! responses carry flags about secrets, never secrets; see `commands::secret`
//! for the reveal and copy paths.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::account::{
    AccountDetail, AccountInput, AccountSummary, AccountUrl, PurposeView, UrlTarget,
};
use vaultair_core::domain::search::BulkResult;
use vaultair_core::search::{AccountFilter, AccountSort};
use vaultair_core::service::accounts;
use vaultair_core::AppError;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// Accounts matching `filter` (active ones, or archived ones if it says
/// so), in `sort` order. An invalid filter is `invalid_input` on `filter`.
#[tauri::command]
#[specta::specta]
pub async fn account_list(
    state: State<'_, AppState>,
    filter: AccountFilter,
    sort: AccountSort,
) -> IpcResult<Vec<AccountSummary>> {
    with_vault(&state, move |v| {
        accounts::list(v, &SystemClock, filter, sort)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn account_get(state: State<'_, AppState>, id: String) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| accounts::get(v, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn account_create(
    state: State<'_, AppState>,
    input: AccountInput,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| accounts::create(v, &SystemClock, &input)).await
}

/// Saves the whole form. Secret fields say `unchanged`, `set` or `clear`.
#[tauri::command]
#[specta::specta]
pub async fn account_update(
    state: State<'_, AppState>,
    id: String,
    input: AccountInput,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::update(v, &SystemClock, &id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn account_archive(state: State<'_, AppState>, id: String) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::set_archived(v, &SystemClock, &id, true)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn account_unarchive(state: State<'_, AppState>, id: String) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::set_archived(v, &SystemClock, &id, false)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn account_set_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::set_favorite(v, &SystemClock, &id, favorite)
    })
    .await
}

/// Stops suggesting that details in the sensitive notes move to their own
/// fields, until the notes change (ADR-0006).
#[tauri::command]
#[specta::specta]
pub async fn account_dismiss_notes_suggestions(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| accounts::dismiss_notes_suggestions(v, &id)).await
}

/// "Mark verified": the user checked the account still works.
#[tauri::command]
#[specta::specta]
pub async fn account_mark_verified(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::mark_verified(v, &SystemClock, &id)
    })
    .await
}

/// Permanently deletes an account. `confirm_title` must be its title, as
/// typed by the user; anything else is `invalid_input` on `confirmTitle`.
#[tauri::command]
#[specta::specta]
pub async fn account_delete(
    state: State<'_, AppState>,
    id: String,
    confirm_title: String,
) -> IpcResult<()> {
    with_vault(&state, move |v| accounts::delete(v, &id, &confirm_title)).await
}

/// A new account from this one's platform details, with no credentials.
#[tauri::command]
#[specta::specta]
pub async fn account_duplicate_as_template(
    state: State<'_, AppState>,
    id: String,
) -> IpcResult<AccountDetail> {
    with_vault(&state, move |v| {
        accounts::duplicate_as_template(v, &SystemClock, &id)
    })
    .await
}

/// The URL "Open in browser" would open, and its host for the confirm dialog.
#[tauri::command]
#[specta::specta]
pub async fn account_url_target(
    state: State<'_, AppState>,
    id: String,
    which: AccountUrl,
) -> IpcResult<UrlTarget> {
    with_vault(&state, move |v| accounts::url_target(v, &id, which)).await
}

/// Opens the account's stored website or login URL in the default browser.
/// The URL is read from the vault and validated again here; the webview
/// can't pass one in. Nothing is filled in or logged in automatically.
#[tauri::command]
#[specta::specta]
pub async fn account_open_url(
    state: State<'_, AppState>,
    id: String,
    which: AccountUrl,
) -> IpcResult<()> {
    let target = with_vault(&state, move |v| accounts::url_target(v, &id, which)).await?;
    tauri::async_runtime::spawn_blocking(move || open_url(&target.url))
        .await
        .map_err(|_| crate::state::ipc_err(AppError::Internal { context: "worker" }))?
        .map_err(crate::state::ipc_err)?;
    tracing::info!("opened an account URL in the browser");
    Ok(())
}

#[cfg(windows)]
fn open_url(url: &str) -> Result<(), AppError> {
    vaultair_platform::windows::open_url(url).map_err(|e| {
        tracing::warn!(error = %e, "could not open the browser");
        AppError::Internal { context: "browser" }
    })
}

#[cfg(not(windows))]
fn open_url(_url: &str) -> Result<(), AppError> {
    Err(AppError::Internal { context: "browser" })
}

/// Adds and removes tags on many accounts at once. All or nothing: one
/// unknown id is `not_found` and changes nothing.
#[tauri::command]
#[specta::specta]
pub async fn account_bulk_tag(
    state: State<'_, AppState>,
    ids: Vec<String>,
    add: Vec<String>,
    remove: Vec<String>,
) -> IpcResult<BulkResult> {
    with_vault(&state, move |v| {
        accounts::bulk_tag(v, &SystemClock, &ids, &add, &remove)
    })
    .await
}

/// Archives (`archived: true`) or restores many accounts at once.
#[tauri::command]
#[specta::specta]
pub async fn account_bulk_archive(
    state: State<'_, AppState>,
    ids: Vec<String>,
    archived: bool,
) -> IpcResult<BulkResult> {
    with_vault(&state, move |v| {
        accounts::bulk_set_archived(v, &SystemClock, &ids, archived)
    })
    .await
}

/// Permanently deletes many accounts. `confirm` must be "DELETE <n>
/// ACCOUNTS" for exactly that many, as typed by the user.
#[tauri::command]
#[specta::specta]
pub async fn account_bulk_delete(
    state: State<'_, AppState>,
    ids: Vec<String>,
    confirm: String,
) -> IpcResult<BulkResult> {
    with_vault(&state, move |v| accounts::bulk_delete(v, &ids, &confirm)).await
}

/// Purposes the account form offers.
#[tauri::command]
#[specta::specta]
pub async fn purpose_list(state: State<'_, AppState>) -> IpcResult<Vec<PurposeView>> {
    with_vault(&state, |v| accounts::purposes(v)).await
}

/// Every tag in the vault, for suggestions.
#[tauri::command]
#[specta::specta]
pub async fn tag_list(state: State<'_, AppState>) -> IpcResult<Vec<String>> {
    with_vault(&state, |v| accounts::tags(v)).await
}
