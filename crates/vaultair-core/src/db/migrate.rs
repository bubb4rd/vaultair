//! Schema migrations, tracked by `PRAGMA user_version`. Each migration runs
//! in its own transaction together with the version bump.
//!
//! Until the first public release, V1 may still change; golden fixtures are
//! regenerated when it does. After release, migrations are append-only and
//! an automatic backup precedes any migration (plan §2.4).

use rusqlite::Connection;

use crate::vault::error::VaultError;

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/V1__init.sql"),
    include_str!("migrations/V2__accounts.sql"),
];

pub fn latest_version() -> u32 {
    // A handful of migrations; fits a u32.
    #[allow(clippy::cast_possible_truncation)]
    let n = MIGRATIONS.len() as u32;
    n
}

pub fn current_version(conn: &Connection) -> Result<u32, VaultError> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

pub fn run(conn: &mut Connection) -> Result<(), VaultError> {
    let current = current_version(conn)?;
    if current > latest_version() {
        return Err(VaultError::TooNew);
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(
            None,
            "user_version",
            i64::try_from(i + 1).unwrap_or(i64::MAX),
        )?;
        tx.commit()?;
        tracing::info!(version = i + 1, "applied schema migration");
    }
    Ok(())
}
