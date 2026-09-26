//! Text queries against the search index (plan §3.1).
//!
//! The index uses the trigram tokenizer, so a word of 3 or more characters
//! matches anywhere inside a field ("sn1p" finds `xX_Sn1per`). Shorter words
//! can't be looked up by trigram; they fall back to a prefix match on the
//! title, username and player ID (a scan, which is cheap at vault scale).

use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection};

use super::filters::Compiled;

/// Results the palette asks for at most.
pub const MAX_HITS: u32 = 50;

/// Column weights for `bm25()`, in the index's column order: the two
/// unindexed id columns, then title, username, email, game, platform,
/// publisher, tags, identity, purpose, notes, region, player_id.
const BM25: &str =
    "bm25(search_index, 0, 0, 10.0, 5.0, 5.0, 3.0, 3.0, 2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 4.0)";

/// A parsed query: every word must match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextQuery {
    /// An FTS5 expression of quoted phrases joined with AND, for words of 3+
    /// characters.
    fts: Option<String>,
    /// `LIKE` patterns (`word%`, escaped with `\`) for shorter words.
    prefixes: Vec<String>,
}

impl TextQuery {
    /// `None` when there's nothing to search for.
    pub fn parse(text: &str) -> Option<Self> {
        let mut phrases = Vec::new();
        let mut prefixes = Vec::new();
        for word in text.split_whitespace() {
            if word.chars().count() >= 3 {
                // Inside an FTS5 string a double quote is written twice;
                // nothing else in it is syntax.
                phrases.push(format!("\"{}\"", word.replace('"', "\"\"")));
            } else {
                let escaped = word
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                prefixes.push(format!("{escaped}%"));
            }
        }
        if phrases.is_empty() && prefixes.is_empty() {
            return None;
        }
        Some(Self {
            fts: (!phrases.is_empty()).then(|| phrases.join(" AND ")),
            prefixes,
        })
    }

    pub fn uses_fts(&self) -> bool {
        self.fts.is_some()
    }

    /// The condition on `search_index` rows (unaliased) and its values, in
    /// marker order.
    fn row_condition(&self) -> (String, Vec<Value>) {
        let mut parts = Vec::new();
        let mut values = Vec::new();
        if let Some(fts) = &self.fts {
            parts.push("search_index MATCH ?#".to_owned());
            values.push(Value::Text(fts.clone()));
        }
        for p in &self.prefixes {
            parts.push(
                "(title LIKE ?# ESCAPE '\\' OR username LIKE ?# ESCAPE '\\' \
                 OR player_id LIKE ?# ESCAPE '\\')"
                    .to_owned(),
            );
            for _ in 0..3 {
                values.push(Value::Text(p.clone()));
            }
        }
        (parts.join(" AND "), values)
    }

    /// Accounts whose own index row matches, or one of whose game profiles
    /// does (a gamertag finds the account it's on).
    /// One pass over the index: matching every word is the expensive part,
    /// so account and profile rows are matched together and then mapped to
    /// the account they belong to.
    pub(crate) fn push_account_predicate(&self, c: &mut Compiled) {
        let (cond, values) = self.row_condition();
        let sql = format!(
            "a.id IN (SELECT CASE entity_type WHEN 'account' THEN entity_id
                        ELSE (SELECT gp.account_id FROM game_profile gp
                              WHERE gp.id = search_index.entity_id) END
                      FROM search_index
                      WHERE {cond} AND entity_type IN ('account', 'game_profile'))"
        );
        c.push(&sql, values);
    }
}

/// What an index row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityType {
    Account,
    Identity,
    GameProfile,
}

impl EntityType {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "account" => Some(Self::Account),
            "identity" => Some(Self::Identity),
            "game_profile" => Some(Self::GameProfile),
            _ => None,
        }
    }
}

/// Index rows matching `query`, best first (bm25 with the column weights
/// above; by title when only short words were typed).
pub fn matches(
    conn: &Connection,
    query: &TextQuery,
    limit: u32,
) -> rusqlite::Result<Vec<(EntityType, String)>> {
    let mut c = Compiled {
        sql: "1".to_owned(),
        params: Vec::new(),
    };
    let (cond, values) = query.row_condition();
    c.push(&cond, values);
    let order = if query.uses_fts() {
        BM25
    } else {
        "title COLLATE NOCASE"
    };
    let sql = format!(
        "SELECT entity_type, entity_id FROM search_index WHERE {} ORDER BY {order} LIMIT {}",
        c.sql,
        limit.min(MAX_HITS)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(c.params.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (kind, id) = row?;
        if let Some(kind) = EntityType::parse(&kind) {
            out.push((kind, id));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_words_become_quoted_phrases() {
        let q = TextQuery::parse("  Sn1per  riot\"games ").unwrap();
        assert_eq!(q.fts.as_deref(), Some("\"Sn1per\" AND \"riot\"\"games\""));
        assert!(q.prefixes.is_empty());
    }

    #[test]
    fn short_words_become_escaped_prefixes() {
        let q = TextQuery::parse("x_ %").unwrap();
        assert_eq!(q.fts, None);
        assert_eq!(q.prefixes, vec!["x\\_%".to_owned(), "\\%%".to_owned()]);
    }

    #[test]
    fn fts_operators_are_plain_text() {
        // Without quoting, these would be FTS5 syntax.
        let q = TextQuery::parse("NOT OR* title:x").unwrap();
        assert_eq!(
            q.fts.as_deref(),
            Some("\"NOT\" AND \"OR*\" AND \"title:x\"")
        );
    }

    #[test]
    fn blank_queries_parse_to_nothing() {
        assert_eq!(TextQuery::parse(""), None);
        assert_eq!(TextQuery::parse(" \t "), None);
    }
}
