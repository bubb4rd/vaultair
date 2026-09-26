//! Global search (the Ctrl+K palette), rebuilding the index, and saved views.

use rusqlite::{Connection, OptionalExtension};

use crate::clock::Clock;
use crate::db::repo::{account, new_id, saved_view};
use crate::domain::search::{SavedView, SavedViewInput, SearchHit};
use crate::domain::validation as v;
use crate::search::filters::MAX_QUERY_CHARS;
use crate::search::query::{self, EntityType, TextQuery};
use crate::search::ViewSpec;
use crate::vault::OpenVault;
use crate::AppError;

pub const MAX_VIEW_NAME_CHARS: usize = 60;
pub const MAX_USER_VIEWS: u32 = 100;

fn identity_hit(conn: &Connection, id: &str) -> rusqlite::Result<Option<SearchHit>> {
    conn.query_row(
        "SELECT id, name, color, primary_email, archived_at IS NOT NULL FROM identity WHERE id = ?1",
        [id],
        |r| {
            Ok(SearchHit::Identity {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                primary_email: r.get(3)?,
                archived: r.get(4)?,
            })
        },
    )
    .optional()
}

/// A game profile's id, gamertag, game name, game icon and account id.
type ProfileRow = (String, Option<String>, String, Option<String>, String);

fn profile_hit(conn: &Connection, id: &str) -> rusqlite::Result<Option<SearchHit>> {
    let row: Option<ProfileRow> = conn
        .query_row(
            "SELECT gp.id, gp.gamertag, g.name, g.icon, gp.account_id
             FROM game_profile gp JOIN game g ON g.id = gp.game_id WHERE gp.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((id, gamertag, game_name, game_icon, account_id)) = row else {
        return Ok(None);
    };
    Ok(
        account::summary(conn, &account_id)?.map(|account| SearchHit::GameProfile {
            id,
            gamertag,
            game_name,
            game_icon,
            account,
        }),
    )
}

fn archived(hit: &SearchHit) -> bool {
    match hit {
        SearchHit::Account { account } | SearchHit::GameProfile { account, .. } => {
            account.archived_at.is_some()
        }
        SearchHit::Identity { archived, .. } => *archived,
    }
}

/// Accounts, identities and game profiles matching `text`, best first,
/// with archived ones after the rest. Never matches a secret: they aren't
/// in the index.
pub fn search(vault: &OpenVault, text: &str, limit: u32) -> Result<Vec<SearchHit>, AppError> {
    if text.chars().count() > MAX_QUERY_CHARS || text.chars().any(char::is_control) {
        return Err(AppError::InvalidInput { field: "query" });
    }
    let Some(q) = TextQuery::parse(text) else {
        return Ok(Vec::new());
    };
    let conn = vault.conn();
    let mut hits = Vec::new();
    for (kind, id) in query::matches(conn, &q, limit)? {
        let hit = match kind {
            EntityType::Account => {
                account::summary(conn, &id)?.map(|a| SearchHit::Account { account: a })
            }
            EntityType::Identity => identity_hit(conn, &id)?,
            EntityType::GameProfile => profile_hit(conn, &id)?,
        };
        hits.extend(hit);
    }
    // Stable: keeps the ranking within each group.
    hits.sort_by_key(archived);
    Ok(hits)
}

/// Writes the whole index again from the tables (recovery). Returns the
/// number of rows.
pub fn rebuild_index(vault: &mut OpenVault) -> Result<u32, AppError> {
    let tx = vault.conn_mut().transaction()?;
    let n = crate::search::index::rebuild(&tx)?;
    tx.commit()?;
    tracing::info!(rows = n, "search index rebuilt");
    Ok(n)
}

// ---- Saved views --------------------------------------------------------------

pub fn views(vault: &OpenVault) -> Result<Vec<SavedView>, AppError> {
    Ok(saved_view::list(vault.conn())?)
}

fn validate_view(
    conn: &Connection,
    input: &SavedViewInput,
    except_id: Option<&str>,
) -> Result<(String, ViewSpec), AppError> {
    let name = v::required(&input.name, "name", MAX_VIEW_NAME_CHARS)?;
    if saved_view::name_taken(conn, &name, except_id)? {
        return Err(AppError::InvalidInput { field: "name" });
    }
    Ok((name, input.spec.clone().validated()?))
}

pub fn create_view(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &SavedViewInput,
) -> Result<SavedView, AppError> {
    let conn = vault.conn();
    if saved_view::user_count(conn)? >= MAX_USER_VIEWS {
        return Err(AppError::InvalidInput { field: "name" });
    }
    let (name, spec) = validate_view(conn, input, None)?;
    let id = new_id();
    saved_view::insert(conn, &id, &name, &spec, &clock.now_rfc3339())?;
    tracing::info!(view = %id, "saved view created");
    saved_view::get(conn, &id)?.ok_or(AppError::Internal {
        context: "saved view",
    })
}

/// Renames a user view or changes its filter. Built-ins can't be changed.
pub fn update_view(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &SavedViewInput,
) -> Result<SavedView, AppError> {
    let conn = vault.conn();
    match saved_view::is_builtin(conn, id)? {
        None => return Err(AppError::NotFound),
        Some(true) => return Err(AppError::InvalidInput { field: "id" }),
        Some(false) => {}
    }
    let (name, spec) = validate_view(conn, input, Some(id))?;
    if !saved_view::update(conn, id, &name, &spec, &clock.now_rfc3339())? {
        return Err(AppError::NotFound);
    }
    saved_view::get(conn, id)?.ok_or(AppError::NotFound)
}

pub fn delete_view(vault: &mut OpenVault, id: &str) -> Result<(), AppError> {
    let conn = vault.conn();
    match saved_view::is_builtin(conn, id)? {
        None => Err(AppError::NotFound),
        Some(true) => Err(AppError::InvalidInput { field: "id" }),
        Some(false) => {
            saved_view::delete(conn, id)?;
            tracing::info!(view = %id, "saved view deleted");
            Ok(())
        }
    }
}
