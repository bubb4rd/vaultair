//! Health checks (Phase 12). Thin: each command runs the matching
//! `vaultair_core::service::health` call. Results name accounts and rules.
//! Passwords and fingerprints stay in the database.

use tauri::State;
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::domain::health::{HealthIssue, HealthRule, HealthSummary};
use vaultair_core::service::health as service;

use super::with_vault;
use crate::state::{AppState, IpcResult};

/// How many active accounts each rule matches. `identity_id` null is the
/// whole vault; an unknown identity is `not_found`.
#[tauri::command]
#[specta::specta]
pub async fn health_summary(
    state: State<'_, AppState>,
    identity_id: Option<String>,
) -> IpcResult<HealthSummary> {
    with_vault(&state, move |v| {
        service::summary(v, identity_id.as_deref(), SystemClock.now_utc())
    })
    .await
}

/// Issues, highest severity first. `rule` keeps one check.
#[tauri::command]
#[specta::specta]
pub async fn health_issues(
    state: State<'_, AppState>,
    identity_id: Option<String>,
    rule: Option<HealthRule>,
) -> IpcResult<Vec<HealthIssue>> {
    with_vault(&state, move |v| {
        service::issues(v, identity_id.as_deref(), rule, SystemClock.now_utc())
    })
    .await
}
