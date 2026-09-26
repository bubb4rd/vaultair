//! The platform and game catalog. Built-ins are seeded from
//! `catalog/default_catalog.json` by the migration that introduced them;
//! users add and edit entries through the services.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use crate::domain::catalog::{GameView, PlatformKind, PlatformView};

const DEFAULT_CATALOG: &str = include_str!("../../../catalog/default_catalog.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedPlatform {
    id: String,
    name: String,
    kind: PlatformKind,
    publisher: Option<String>,
    default_login_url: Option<String>,
    icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedGame {
    id: String,
    name: String,
    franchise: Option<String>,
    publisher: Option<String>,
    icon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SeedCatalog {
    platforms: Vec<SeedPlatform>,
    games: Vec<SeedGame>,
}

fn default_catalog() -> serde_json::Result<SeedCatalog> {
    serde_json::from_str(DEFAULT_CATALOG)
}

/// Inserts the built-in platforms and games. Idempotent: `INSERT OR IGNORE`
/// keeps rows that already exist, whether a built-in the user edited or a
/// user entry with the same name. Returns false if the bundled JSON doesn't
/// parse (a build defect; a unit test guards it).
pub fn seed_builtins(conn: &Connection) -> rusqlite::Result<bool> {
    let Ok(catalog) = default_catalog() else {
        tracing::error!("the bundled platform and game catalog is invalid");
        return Ok(false);
    };
    let mut platform = conn.prepare(
        "INSERT OR IGNORE INTO platform (id, name, kind, publisher, default_login_url, icon,
            is_builtin, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
    )?;
    for p in &catalog.platforms {
        platform.execute(params![
            p.id,
            p.name,
            p.kind,
            p.publisher,
            p.default_login_url,
            p.icon
        ])?;
    }
    let mut game = conn.prepare(
        "INSERT OR IGNORE INTO game (id, name, franchise, publisher, icon, is_builtin,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
    )?;
    for g in &catalog.games {
        game.execute(params![g.id, g.name, g.franchise, g.publisher, g.icon])?;
    }
    Ok(true)
}

fn count(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

// ---- Platforms -----------------------------------------------------------------

/// The editable columns of a platform, already validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformFields {
    pub name: String,
    pub kind: PlatformKind,
    pub publisher: Option<String>,
    pub default_login_url: Option<String>,
}

const PLATFORM_SELECT: &str = "
    SELECT pl.id, pl.name, pl.kind, pl.publisher, pl.default_login_url, pl.icon, pl.is_builtin,
           (SELECT COUNT(*) FROM account a WHERE a.platform_id = pl.id AND a.archived_at IS NULL),
           (SELECT COUNT(*) FROM game_profile gp JOIN account a ON a.id = gp.account_id
             WHERE gp.platform_id = pl.id AND a.archived_at IS NULL)
    FROM platform pl";

fn platform_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PlatformView> {
    Ok(PlatformView {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        publisher: r.get(3)?,
        default_login_url: r.get(4)?,
        icon: r.get(5)?,
        is_builtin: r.get(6)?,
        account_count: count(r.get(7)?),
        profile_count: count(r.get(8)?),
    })
}

/// Every platform, by name.
pub fn platforms(conn: &Connection) -> rusqlite::Result<Vec<PlatformView>> {
    let sql = format!("{PLATFORM_SELECT} ORDER BY pl.name COLLATE NOCASE, pl.id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], platform_row)?;
    rows.collect()
}

pub fn platform(conn: &Connection, id: &str) -> rusqlite::Result<Option<PlatformView>> {
    let sql = format!("{PLATFORM_SELECT} WHERE pl.id = ?1");
    conn.query_row(&sql, [id], platform_row).optional()
}

pub fn platform_exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM platform WHERE id = ?1)",
        [id],
        |r| r.get(0),
    )
}

pub fn platform_name_taken(
    conn: &Connection,
    name: &str,
    except: Option<&str>,
) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM platform WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )
}

pub fn insert_platform(
    conn: &Connection,
    id: &str,
    f: &PlatformFields,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO platform (id, name, kind, publisher, default_login_url, is_builtin,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
        params![id, f.name, f.kind, f.publisher, f.default_login_url, now],
    )?;
    Ok(())
}

/// Returns false if there is no such platform. A built-in keeps its logo.
pub fn update_platform(
    conn: &Connection,
    id: &str,
    f: &PlatformFields,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE platform SET name = ?2, kind = ?3, publisher = ?4, default_login_url = ?5,
            updated_at = ?6
         WHERE id = ?1",
        params![id, f.name, f.kind, f.publisher, f.default_login_url, now],
    )? == 1)
}

/// Accounts on the platform, archived ones included (their search rows name
/// it too).
pub fn accounts_on_platform(conn: &Connection, id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM account WHERE platform_id = ?1")?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    rows.collect()
}

// ---- Games -----------------------------------------------------------------------

/// The editable columns of a game, already validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameFields {
    pub name: String,
    pub franchise: Option<String>,
    pub publisher: Option<String>,
}

const GAME_SELECT: &str = "
    SELECT g.id, g.name, g.franchise, g.publisher, g.icon, g.is_builtin,
           (SELECT COUNT(*) FROM account a WHERE a.game_id = g.id AND a.archived_at IS NULL),
           (SELECT COUNT(*) FROM game_profile gp JOIN account a ON a.id = gp.account_id
             WHERE gp.game_id = g.id AND a.archived_at IS NULL)
    FROM game g";

fn game_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<GameView> {
    Ok(GameView {
        id: r.get(0)?,
        name: r.get(1)?,
        franchise: r.get(2)?,
        publisher: r.get(3)?,
        icon: r.get(4)?,
        is_builtin: r.get(5)?,
        account_count: count(r.get(6)?),
        profile_count: count(r.get(7)?),
    })
}

/// Every game, by name.
pub fn games(conn: &Connection) -> rusqlite::Result<Vec<GameView>> {
    let sql = format!("{GAME_SELECT} ORDER BY g.name COLLATE NOCASE, g.id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], game_row)?;
    rows.collect()
}

pub fn game(conn: &Connection, id: &str) -> rusqlite::Result<Option<GameView>> {
    let sql = format!("{GAME_SELECT} WHERE g.id = ?1");
    conn.query_row(&sql, [id], game_row).optional()
}

pub fn game_exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM game WHERE id = ?1)",
        [id],
        |r| r.get(0),
    )
}

pub fn game_name_taken(
    conn: &Connection,
    name: &str,
    except: Option<&str>,
) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM game WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )
}

pub fn insert_game(conn: &Connection, id: &str, f: &GameFields, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO game (id, name, franchise, publisher, is_builtin, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![id, f.name, f.franchise, f.publisher, now],
    )?;
    Ok(())
}

/// Returns false if there is no such game. A built-in keeps its logo.
pub fn update_game(
    conn: &Connection,
    id: &str,
    f: &GameFields,
    now: &str,
) -> rusqlite::Result<bool> {
    Ok(conn.execute(
        "UPDATE game SET name = ?2, franchise = ?3, publisher = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, f.name, f.franchise, f.publisher, now],
    )? == 1)
}

/// Accounts for the game, archived ones included.
pub fn accounts_for_game(conn: &Connection, id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM account WHERE game_id = ?1")?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_catalog_parses_with_unique_ids_and_names() {
        let c = default_catalog().expect("default_catalog.json must parse");
        assert!(c.platforms.len() >= 10 && c.games.len() >= 10);
        let mut ids = std::collections::HashSet::new();
        let mut names = std::collections::HashSet::new();
        for p in &c.platforms {
            assert!(ids.insert(p.id.clone()), "duplicate id {}", p.id);
            assert!(names.insert(format!("p:{}", p.name.to_lowercase())));
            if let Some(url) = &p.default_login_url {
                assert!(url.starts_with("https://"), "{url}");
            }
        }
        for g in &c.games {
            assert!(ids.insert(g.id.clone()), "duplicate id {}", g.id);
            assert!(names.insert(format!("g:{}", g.name.to_lowercase())));
        }
    }
}
