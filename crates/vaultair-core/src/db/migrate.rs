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
    include_str!("migrations/V3__identities.sql"),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// V3 backfills login-email contact points for accounts saved before it,
    /// folding case the same way `normalize_contact` does.
    #[test]
    fn v3_backfills_login_emails_as_contact_points() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for sql in &MIGRATIONS[..2] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 2).unwrap();
        for (id, email) in [
            ("a1", Some("Me@Example.com")),
            ("a2", Some(" me@example.com")),
            ("a3", Some("other@example.com")),
            ("a4", None),
        ] {
            conn.execute(
                "INSERT INTO account (id, title, account_type, purpose_id, email, created_at, updated_at)
                 VALUES (?1, ?1, 'launcher', 'builtin-main', ?2, 'now', 'now')",
                rusqlite::params![id, email],
            )
            .unwrap();
        }

        run(&mut conn).unwrap();

        let contacts: Vec<(String, String)> = conn
            .prepare("SELECT value_normalized, value_display FROM contact_point ORDER BY 1")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            contacts,
            [
                ("me@example.com".to_owned(), "me@example.com".to_owned()),
                (
                    "other@example.com".to_owned(),
                    "other@example.com".to_owned()
                ),
            ]
        );
        assert_eq!(
            crate::domain::identity::normalize_contact("Me@Example.com"),
            contacts[0].0
        );
        let links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM account_contact WHERE role = 'login_email'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(links, 3);
    }
}
