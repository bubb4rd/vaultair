//! The platform and game catalog (list, add, edit) and game profiles on
//! accounts (list, add, edit, delete).
//!
//! Search rows name an account's platform and game and a profile's game and
//! platform, so renaming a catalog entry reindexes everything that uses it,
//! in the same transaction.

use rusqlite::Connection;

use crate::clock::Clock;
use crate::db::repo::catalog::{self as repo, GameFields, PlatformFields};
use crate::db::repo::game_profile::{self as profiles, ProfileFields};
use crate::db::repo::{account as account_repo, new_id};
use crate::domain::catalog::{
    GameInput, GameProfileFilter, GameProfileInput, GameProfileView, GameView, PlatformInput,
    PlatformView,
};
use crate::domain::validation::{self as v, MAX_NOTES_CHARS, MAX_SHORT_CHARS, MAX_TITLE_CHARS};
use crate::vault::OpenVault;
use crate::AppError;

fn not_found<T>(value: Option<T>) -> Result<T, AppError> {
    value.ok_or(AppError::NotFound)
}

/// Rewrites the search rows of the accounts and profiles that name a
/// catalog entry.
fn reindex_uses(
    conn: &Connection,
    accounts: &[String],
    game_id: Option<&str>,
    platform_id: Option<&str>,
) -> Result<(), AppError> {
    for id in accounts {
        account_repo::reindex(conn, id)?;
    }
    for id in profiles::ids_for_catalog(conn, game_id, platform_id)? {
        profiles::reindex(conn, &id)?;
    }
    Ok(())
}

// ---- Platforms -----------------------------------------------------------------

pub fn platforms(vault: &OpenVault) -> Result<Vec<PlatformView>, AppError> {
    Ok(repo::platforms(vault.conn())?)
}

fn validate_platform(
    conn: &Connection,
    input: &PlatformInput,
    id: Option<&str>,
) -> Result<PlatformFields, AppError> {
    let name = v::required(&input.name, "name", MAX_TITLE_CHARS)?;
    if repo::platform_name_taken(conn, &name, id)? {
        return Err(AppError::InvalidInput { field: "name" });
    }
    Ok(PlatformFields {
        name,
        kind: input.kind,
        publisher: v::optional(input.publisher.as_deref(), "publisher", MAX_SHORT_CHARS)?,
        default_login_url: v::optional_web_url(
            input.default_login_url.as_deref(),
            "defaultLoginUrl",
        )?,
    })
}

pub fn create_platform(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &PlatformInput,
) -> Result<PlatformView, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate_platform(&tx, input, None)?;
    repo::insert_platform(&tx, &id, &fields, &now)?;
    tx.commit()?;
    tracing::info!(platform = %id, "platform created");
    not_found(repo::platform(vault.conn(), &id)?)
}

pub fn update_platform(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &PlatformInput,
) -> Result<PlatformView, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate_platform(&tx, input, Some(id))?;
    if !repo::update_platform(&tx, id, &fields, &now)? {
        return Err(AppError::NotFound);
    }
    let accounts = repo::accounts_on_platform(&tx, id)?;
    reindex_uses(&tx, &accounts, None, Some(id))?;
    tx.commit()?;
    tracing::info!(platform = %id, "platform updated");
    not_found(repo::platform(vault.conn(), id)?)
}

// ---- Games -----------------------------------------------------------------------

pub fn games(vault: &OpenVault) -> Result<Vec<GameView>, AppError> {
    Ok(repo::games(vault.conn())?)
}

fn validate_game(
    conn: &Connection,
    input: &GameInput,
    id: Option<&str>,
) -> Result<GameFields, AppError> {
    let name = v::required(&input.name, "name", MAX_TITLE_CHARS)?;
    if repo::game_name_taken(conn, &name, id)? {
        return Err(AppError::InvalidInput { field: "name" });
    }
    Ok(GameFields {
        name,
        franchise: v::optional(input.franchise.as_deref(), "franchise", MAX_SHORT_CHARS)?,
        publisher: v::optional(input.publisher.as_deref(), "publisher", MAX_SHORT_CHARS)?,
    })
}

pub fn create_game(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &GameInput,
) -> Result<GameView, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate_game(&tx, input, None)?;
    repo::insert_game(&tx, &id, &fields, &now)?;
    tx.commit()?;
    tracing::info!(game = %id, "game created");
    not_found(repo::game(vault.conn(), &id)?)
}

pub fn update_game(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &GameInput,
) -> Result<GameView, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate_game(&tx, input, Some(id))?;
    if !repo::update_game(&tx, id, &fields, &now)? {
        return Err(AppError::NotFound);
    }
    let accounts = repo::accounts_for_game(&tx, id)?;
    reindex_uses(&tx, &accounts, Some(id), None)?;
    tx.commit()?;
    tracing::info!(game = %id, "game updated");
    not_found(repo::game(vault.conn(), id)?)
}

// ---- Game profiles -----------------------------------------------------------------

pub fn profiles(
    vault: &OpenVault,
    filter: &GameProfileFilter,
) -> Result<Vec<GameProfileView>, AppError> {
    Ok(profiles::list(vault.conn(), filter)?)
}

/// A linked launcher or console account: another account that exists.
fn linked_account(
    conn: &Connection,
    value: Option<&str>,
    own: &str,
    field: &'static str,
) -> Result<Option<String>, AppError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(id) if id == own => Err(AppError::InvalidInput { field }),
        Some(id) => {
            if account_repo::title(conn, id)?.is_none() {
                return Err(AppError::InvalidInput { field });
            }
            Ok(Some(id.to_owned()))
        }
    }
}

fn validate_profile(
    conn: &Connection,
    account_id: &str,
    input: &GameProfileInput,
) -> Result<ProfileFields, AppError> {
    if !repo::game_exists(conn, &input.game_id)? {
        return Err(AppError::InvalidInput { field: "gameId" });
    }
    let platform_id = match input.platform_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(id) => {
            if !repo::platform_exists(conn, id)? {
                return Err(AppError::InvalidInput {
                    field: "platformId",
                });
            }
            Some(id.to_owned())
        }
    };
    Ok(ProfileFields {
        game_id: input.game_id.clone(),
        platform_id,
        gamertag: v::optional(input.gamertag.as_deref(), "gamertag", MAX_SHORT_CHARS)?,
        player_id: v::optional(input.player_id.as_deref(), "playerId", MAX_SHORT_CHARS)?,
        region: v::optional(input.region.as_deref(), "region", MAX_SHORT_CHARS)?,
        rank_tier: v::optional(input.rank_tier.as_deref(), "rankTier", MAX_SHORT_CHARS)?,
        current_season: v::optional(
            input.current_season.as_deref(),
            "currentSeason",
            MAX_SHORT_CHARS,
        )?,
        notes: v::optional_multiline(input.notes.as_deref(), "notes", MAX_NOTES_CHARS)?,
        linked_launcher_account_id: linked_account(
            conn,
            input.linked_launcher_account_id.as_deref(),
            account_id,
            "linkedLauncherAccountId",
        )?,
        linked_console_account_id: linked_account(
            conn,
            input.linked_console_account_id.as_deref(),
            account_id,
            "linkedConsoleAccountId",
        )?,
    })
}

/// Adds a profile to an account. Counts as an edit of the account.
pub fn create_profile(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    account_id: &str,
    input: &GameProfileInput,
) -> Result<GameProfileView, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let tx = vault.conn_mut().transaction()?;
    if account_repo::title(&tx, account_id)?.is_none() {
        return Err(AppError::NotFound);
    }
    let fields = validate_profile(&tx, account_id, input)?;
    profiles::insert(&tx, &id, account_id, &fields, &now)?;
    account_repo::touch(&tx, account_id, &now)?;
    profiles::reindex(&tx, &id)?;
    tx.commit()?;
    tracing::info!(profile = %id, account = %account_id, "game profile created");
    not_found(profiles::get(vault.conn(), &id)?)
}

pub fn update_profile(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &GameProfileInput,
) -> Result<GameProfileView, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let account_id = not_found(profiles::account_of(&tx, id)?)?;
    let fields = validate_profile(&tx, &account_id, input)?;
    profiles::update(&tx, id, &fields, &now)?;
    account_repo::touch(&tx, &account_id, &now)?;
    profiles::reindex(&tx, id)?;
    tx.commit()?;
    tracing::info!(profile = %id, "game profile updated");
    not_found(profiles::get(vault.conn(), id)?)
}

pub fn delete_profile(vault: &mut OpenVault, clock: &dyn Clock, id: &str) -> Result<(), AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let account_id = not_found(profiles::account_of(&tx, id)?)?;
    profiles::delete(&tx, id)?;
    account_repo::touch(&tx, &account_id, &now)?;
    tx.commit()?;
    tracing::info!(profile = %id, "game profile deleted");
    Ok(())
}
