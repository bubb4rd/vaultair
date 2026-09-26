//! The platform and game catalog, and the game profiles on accounts.
//!
//! Built-in catalog entries come from `catalog/default_catalog.json`; users
//! can add and edit entries. `icon` names a bundled logo (a Simple Icons
//! slug) and is only set on built-ins; the UI draws a monogram without one.

use serde::{Deserialize, Serialize};

use crate::domain::account::text_enum;

text_enum!(
    /// What kind of service a platform is. Mirrors `platform.kind`.
    PlatformKind {
        Launcher => "launcher",
        Console => "console",
        Publisher => "publisher",
        Social => "social",
        Streaming => "streaming",
        Email => "email",
        Website => "website",
        App => "app",
        Other => "other",
    }
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlatformView {
    pub id: String,
    pub name: String,
    pub kind: PlatformKind,
    pub publisher: Option<String>,
    /// For built-ins, catalog-provided; the UI labels it as such.
    pub default_login_url: Option<String>,
    pub icon: Option<String>,
    pub is_builtin: bool,
    /// Active accounts on this platform.
    pub account_count: u32,
    /// Game profiles played on this platform (on active accounts).
    pub profile_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub id: String,
    pub name: String,
    pub franchise: Option<String>,
    pub publisher: Option<String>,
    pub icon: Option<String>,
    pub is_builtin: bool,
    /// Active accounts for this game.
    pub account_count: u32,
    /// Game profiles for this game (on active accounts).
    pub profile_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlatformInput {
    pub name: String,
    pub kind: PlatformKind,
    pub publisher: Option<String>,
    pub default_login_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameInput {
    pub name: String,
    pub franchise: Option<String>,
    pub publisher: Option<String>,
}

/// A game profile as the form sends it: who you are in one game, on one
/// account.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameProfileInput {
    pub game_id: String,
    pub platform_id: Option<String>,
    pub gamertag: Option<String>,
    pub player_id: Option<String>,
    pub region: Option<String>,
    pub rank_tier: Option<String>,
    pub current_season: Option<String>,
    pub notes: Option<String>,
    /// The launcher account this profile is reached through, if any.
    pub linked_launcher_account_id: Option<String>,
    /// The console account this profile is played on, if any.
    pub linked_console_account_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameProfileView {
    pub id: String,
    pub account_id: String,
    pub account_title: String,
    pub game_id: String,
    pub game_name: String,
    pub game_icon: Option<String>,
    pub platform_id: Option<String>,
    pub platform_name: Option<String>,
    pub gamertag: Option<String>,
    pub player_id: Option<String>,
    pub region: Option<String>,
    pub rank_tier: Option<String>,
    pub current_season: Option<String>,
    pub notes: Option<String>,
    pub linked_launcher_account_id: Option<String>,
    pub linked_launcher_title: Option<String>,
    pub linked_console_account_id: Option<String>,
    pub linked_console_title: Option<String>,
    pub updated_at: String,
}

/// Which game profiles to list. Every set field must match. Unless
/// `account_id` is set, profiles on archived accounts are left out.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameProfileFilter {
    pub account_id: Option<String>,
    pub game_id: Option<String>,
    pub platform_id: Option<String>,
}
