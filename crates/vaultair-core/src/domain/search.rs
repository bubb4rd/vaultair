//! What global search, saved views and bulk actions send and return.

use serde::{Deserialize, Serialize};

use crate::domain::account::AccountSummary;
use crate::domain::identity::IdentityColor;
use crate::search::ViewSpec;

/// A saved view: a named filter and sort for the account list. Built-ins
/// (seeded by migration V7) can't be edited or deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: String,
    pub name: String,
    /// A short icon name the UI maps to a glyph ("crown", "clock"...).
    pub icon: Option<String>,
    pub spec: ViewSpec,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SavedViewInput {
    pub name: String,
    pub spec: ViewSpec,
}

/// One result in the Ctrl+K palette. Carries what the row shows, never a
/// secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchHit {
    #[serde(rename_all = "camelCase")]
    Account { account: AccountSummary },
    #[serde(rename_all = "camelCase")]
    Identity {
        id: String,
        name: String,
        color: Option<IdentityColor>,
        primary_email: Option<String>,
        archived: bool,
    },
    /// A game profile; opening it opens the account it's on.
    #[serde(rename_all = "camelCase")]
    GameProfile {
        id: String,
        gamertag: Option<String>,
        game_name: String,
        game_icon: Option<String>,
        account: AccountSummary,
    },
}

/// What a bulk action did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BulkResult {
    /// Accounts the action applied to.
    pub changed: u32,
}
