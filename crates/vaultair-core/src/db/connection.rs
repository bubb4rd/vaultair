//! Opening the SQLCipher database with pinned settings.
//!
//! Order matters: logging off, then the raw key, then the pinned cipher
//! settings (they must precede the first read), then a read to verify the
//! key, then the ordinary pragmas.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use crate::crypto::keys::VaultKeys;
use crate::vault::error::{CorruptPart, VaultError};
use crate::vault::header::DbSection;

pub(crate) fn open(path: &Path, keys: &VaultKeys, create: bool) -> Result<Connection, VaultError> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let conn = Connection::open_with_flags(path, flags)?;

    // SQLCipher logs failed HMAC checks to stderr by default; errors are
    // handled (and logged, redacted) by us instead.
    let _ = conn.execute_batch("PRAGMA cipher_log_level = NONE;");

    let key = keys.sqlcipher_key_literal();
    conn.pragma_update(None, "key", key.as_str())?;
    drop(key);

    let pinned = DbSection::pinned();
    conn.pragma_update(None, "cipher_compatibility", pinned.compat)?;
    conn.pragma_update(None, "cipher_page_size", pinned.page_size)?;
    conn.pragma_update(None, "cipher_hmac_algorithm", &pinned.hmac)?;
    conn.pragma_update(None, "cipher_kdf_algorithm", &pinned.kdf)?;
    conn.pragma_update(
        None,
        "cipher_plaintext_header_size",
        pinned.plaintext_header_size,
    )?;
    conn.pragma_update(None, "cipher_memory_security", "ON")?;

    // First read: fails with NOTADB if the key (or file) is wrong.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| VaultError::Corrupted(CorruptPart::Database))?;

    conn.execute_batch(
        "PRAGMA temp_store = MEMORY;
         PRAGMA secure_delete = ON;
         PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA trusted_schema = OFF;
         PRAGMA cell_size_check = ON;",
    )?;
    Ok(conn)
}

/// `cipher_integrity_check` verifies every page's HMAC; `quick_check` the
/// SQLite structure. Both return no problem rows / "ok" when healthy.
pub(crate) fn integrity_ok(conn: &Connection) -> Result<bool, VaultError> {
    let cipher_problems = {
        let mut stmt = conn.prepare("PRAGMA cipher_integrity_check")?;
        let mut rows = stmt.query([])?;
        let mut n = 0u32;
        while rows
            .next()
            .map_err(|_| VaultError::Corrupted(CorruptPart::Database))?
            .is_some()
        {
            n += 1;
        }
        n
    };
    if cipher_problems > 0 {
        tracing::warn!(pages = cipher_problems, "cipher integrity check failed");
        return Ok(false);
    }
    let quick: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| VaultError::Corrupted(CorruptPart::Database))?;
    Ok(quick == "ok")
}
