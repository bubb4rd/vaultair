//! Platform, game and game profile commands (Phase 10). Thin: each one runs
//! the matching `vaultair_core::service::catalog` call against the unlocked
//! vault. Nothing here carries a secret.

use tauri::State;
use vaultair_core::clock::SystemClock;
use vaultair_core::domain::catalog::{
    GameInput, GameProfileFilter, GameProfileInput, GameProfileView, GameView, PlatformInput,
    PlatformView,
};
use vaultair_core::service::catalog;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// Every platform, built-in and user-added, with how many accounts use each.
#[tauri::command]
#[specta::specta]
pub async fn platform_list(state: State<'_, AppState>) -> IpcResult<Vec<PlatformView>> {
    with_vault(&state, |v| catalog::platforms(v)).await
}

#[tauri::command]
#[specta::specta]
pub async fn platform_create(
    state: State<'_, AppState>,
    input: PlatformInput,
) -> IpcResult<PlatformView> {
    with_vault(&state, move |v| {
        catalog::create_platform(v, &SystemClock, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn platform_update(
    state: State<'_, AppState>,
    id: String,
    input: PlatformInput,
) -> IpcResult<PlatformView> {
    with_vault(&state, move |v| {
        catalog::update_platform(v, &SystemClock, &id, &input)
    })
    .await
}

/// Every game, built-in and user-added, with how many accounts and profiles
/// use each.
#[tauri::command]
#[specta::specta]
pub async fn game_list(state: State<'_, AppState>) -> IpcResult<Vec<GameView>> {
    with_vault(&state, |v| catalog::games(v)).await
}

#[tauri::command]
#[specta::specta]
pub async fn game_create(state: State<'_, AppState>, input: GameInput) -> IpcResult<GameView> {
    with_vault(&state, move |v| {
        catalog::create_game(v, &SystemClock, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_update(
    state: State<'_, AppState>,
    id: String,
    input: GameInput,
) -> IpcResult<GameView> {
    with_vault(&state, move |v| {
        catalog::update_game(v, &SystemClock, &id, &input)
    })
    .await
}

/// Game profiles on one account, or for one game or platform.
#[tauri::command]
#[specta::specta]
pub async fn game_profile_list(
    state: State<'_, AppState>,
    filter: GameProfileFilter,
) -> IpcResult<Vec<GameProfileView>> {
    with_vault(&state, move |v| catalog::profiles(v, &filter)).await
}

#[tauri::command]
#[specta::specta]
pub async fn game_profile_create(
    state: State<'_, AppState>,
    account_id: String,
    input: GameProfileInput,
) -> IpcResult<GameProfileView> {
    with_vault(&state, move |v| {
        catalog::create_profile(v, &SystemClock, &account_id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_profile_update(
    state: State<'_, AppState>,
    id: String,
    input: GameProfileInput,
) -> IpcResult<GameProfileView> {
    with_vault(&state, move |v| {
        catalog::update_profile(v, &SystemClock, &id, &input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_profile_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    with_vault(&state, move |v| {
        catalog::delete_profile(v, &SystemClock, &id)
    })
    .await
}
