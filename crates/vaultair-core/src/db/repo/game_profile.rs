//! Game profiles (who you are in one game, on one account), plus their rows
//! in the search index, kept in step inside the same transaction as every
//! write.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::catalog::{GameProfileFilter, GameProfileView};

/// The columns a profile form edits, already validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileFields {
    pub game_id: String,
    pub platform_id: Option<String>,
    pub gamertag: Option<String>,
    pub player_id: Option<String>,
    pub region: Option<String>,
    pub rank_tier: Option<String>,
    pub current_season: Option<String>,
    pub notes: Option<String>,
    pub linked_launcher_account_id: Option<String>,
    pub linked_console_account_id: Option<String>,
}

pub fn insert(
    conn: &Connection,
    id: &str,
    account_id: &str,
    f: &ProfileFields,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO game_profile (id, account_id, game_id, platform_id, gamertag, player_id,
            region, rank_tier, current_season, notes, linked_launcher_account_id,
            linked_console_account_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        params![
            id,
            account_id,
            f.game_id,
            f.platform_id,
            f.gamertag,
            f.player_id,
            f.region,
            f.rank_tier,
            f.current_season,
            f.notes,
            f.linked_launcher_account_id,
            f.linked_console_account_id,
            now
        ],
    )?;
    Ok(())
}

/// Returns false if there is no such profile.
pub fn update(conn: &Connection, id: &str, f: &ProfileFields, now: &str) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE game_profile SET game_id = ?2, platform_id = ?3, gamertag = ?4, player_id = ?5,
            region = ?6, rank_tier = ?7, current_season = ?8, notes = ?9,
            linked_launcher_account_id = ?10, linked_console_account_id = ?11, updated_at = ?12
         WHERE id = ?1",
        params![
            id,
            f.game_id,
            f.platform_id,
            f.gamertag,
            f.player_id,
            f.region,
            f.rank_tier,
            f.current_season,
            f.notes,
            f.linked_launcher_account_id,
            f.linked_console_account_id,
            now
        ],
    )? == 1)
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    unindex(conn, id)?;
    Ok(conn.execute("DELETE FROM game_profile WHERE id = ?1", [id])? == 1)
}

/// The account a profile belongs to. `None`: no such profile.
pub fn account_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT account_id FROM game_profile WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .optional()
}

const VIEW_SELECT: &str = "
    SELECT gp.id, gp.account_id, a.title, gp.game_id, g.name, g.icon, gp.platform_id, pl.name,
           gp.gamertag, gp.player_id, gp.region, gp.rank_tier, gp.current_season, gp.notes,
           gp.linked_launcher_account_id, la.title, gp.linked_console_account_id, ca.title,
           gp.updated_at
    FROM game_profile gp
    JOIN account a ON a.id = gp.account_id
    JOIN game g ON g.id = gp.game_id
    LEFT JOIN platform pl ON pl.id = gp.platform_id
    LEFT JOIN account la ON la.id = gp.linked_launcher_account_id
    LEFT JOIN account ca ON ca.id = gp.linked_console_account_id";

fn view_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<GameProfileView> {
    Ok(GameProfileView {
        id: r.get(0)?,
        account_id: r.get(1)?,
        account_title: r.get(2)?,
        game_id: r.get(3)?,
        game_name: r.get(4)?,
        game_icon: r.get(5)?,
        platform_id: r.get(6)?,
        platform_name: r.get(7)?,
        gamertag: r.get(8)?,
        player_id: r.get(9)?,
        region: r.get(10)?,
        rank_tier: r.get(11)?,
        current_season: r.get(12)?,
        notes: r.get(13)?,
        linked_launcher_account_id: r.get(14)?,
        linked_launcher_title: r.get(15)?,
        linked_console_account_id: r.get(16)?,
        linked_console_title: r.get(17)?,
        updated_at: r.get(18)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<GameProfileView>> {
    let sql = format!("{VIEW_SELECT} WHERE gp.id = ?1");
    conn.query_row(&sql, [id], view_row).optional()
}

/// Profiles matching `filter`, by game then gamertag.
pub fn list(
    conn: &Connection,
    filter: &GameProfileFilter,
) -> rusqlite::Result<Vec<GameProfileView>> {
    let sql = format!(
        "{VIEW_SELECT}
         WHERE (?1 IS NULL AND a.archived_at IS NULL OR gp.account_id = ?1)
           AND (?2 IS NULL OR gp.game_id = ?2)
           AND (?3 IS NULL OR gp.platform_id = ?3)
         ORDER BY g.name COLLATE NOCASE, gp.gamertag COLLATE NOCASE, gp.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![filter.account_id, filter.game_id, filter.platform_id],
        view_row,
    )?;
    rows.collect()
}

/// Profiles whose search rows name this game or platform.
pub fn ids_for_catalog(
    conn: &Connection,
    game_id: Option<&str>,
    platform_id: Option<&str>,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT id FROM game_profile WHERE game_id = ?1 OR platform_id = ?2")?;
    let rows = stmt.query_map(params![game_id, platform_id], |r| r.get(0))?;
    rows.collect()
}

// ---- Search index -----------------------------------------------------------

/// Rewrites the profile's search row: gamertag as the title, the game,
/// platform and publisher, player ID, region, and rank, season and notes
/// together as notes.
pub fn reindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    unindex(conn, id)?;
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, title, username, email, game, platform,
            publisher, tags, identity, purpose, notes, region, player_id)
         SELECT 'game_profile', gp.id, COALESCE(gp.gamertag, g.name), '', '', g.name,
                COALESCE(pl.name, ''), COALESCE(g.publisher, ''), '', '', '',
                trim(COALESCE(gp.rank_tier, '') || ' ' || COALESCE(gp.current_season, '') || ' '
                     || COALESCE(gp.notes, '')),
                COALESCE(gp.region, ''), COALESCE(gp.player_id, '')
         FROM game_profile gp
         JOIN game g ON g.id = gp.game_id
         LEFT JOIN platform pl ON pl.id = gp.platform_id
         WHERE gp.id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn unindex(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = 'game_profile' AND entity_id = ?1",
        [id],
    )?;
    Ok(())
}

/// Removes the search rows of every profile on an account (before the
/// account's delete cascades to the profiles).
pub fn unindex_for_account(conn: &Connection, account_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = 'game_profile'
           AND entity_id IN (SELECT id FROM game_profile WHERE account_id = ?1)",
        [account_id],
    )?;
    Ok(())
}
