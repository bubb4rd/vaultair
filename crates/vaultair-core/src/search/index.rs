//! Keeping the search index honest. Rows are written by each repository
//! inside the same transaction as the change (`repo::*::reindex`); this is
//! the recovery path and the check that they haven't drifted.

use rusqlite::Connection;

use crate::db::repo::{account, game_profile, identity};

fn ids(conn: &Connection, sql: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// Throws the index away and writes every row again from the tables. Run it
/// inside a transaction. Returns how many rows it wrote.
pub fn rebuild(conn: &Connection) -> rusqlite::Result<u32> {
    conn.execute("DELETE FROM search_index", [])?;
    let mut n: u32 = 0;
    for id in ids(conn, "SELECT id FROM account")? {
        account::reindex(conn, &id)?;
        n = n.saturating_add(1);
    }
    for id in ids(conn, "SELECT id FROM identity")? {
        identity::reindex(conn, &id)?;
        n = n.saturating_add(1);
    }
    for id in ids(conn, "SELECT id FROM game_profile")? {
        game_profile::reindex(conn, &id)?;
        n = n.saturating_add(1);
    }
    Ok(n)
}

/// One index row per account, identity and game profile, and none for
/// anything that no longer exists.
pub fn consistent(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT
           (SELECT COUNT(*) FROM search_index WHERE entity_type = 'account')
             = (SELECT COUNT(*) FROM account)
           AND (SELECT COUNT(*) FROM search_index WHERE entity_type = 'identity')
             = (SELECT COUNT(*) FROM identity)
           AND (SELECT COUNT(*) FROM search_index WHERE entity_type = 'game_profile')
             = (SELECT COUNT(*) FROM game_profile)
           AND NOT EXISTS(SELECT 1 FROM search_index s WHERE
                 (s.entity_type = 'account'
                    AND NOT EXISTS(SELECT 1 FROM account x WHERE x.id = s.entity_id))
              OR (s.entity_type = 'identity'
                    AND NOT EXISTS(SELECT 1 FROM identity x WHERE x.id = s.entity_id))
              OR (s.entity_type = 'game_profile'
                    AND NOT EXISTS(SELECT 1 FROM game_profile x WHERE x.id = s.entity_id))
              OR s.entity_type NOT IN ('account', 'identity', 'game_profile'))",
        [],
        |r| r.get(0),
    )
}
