//! The account filter language: what the filter chips, saved views and the
//! list's text box send, validated here and compiled to SQL predicates.
//!
//! SQL text only ever comes from the constants in this file. Every value
//! the user chose is bound as a parameter; lists are bound as one JSON array
//! and read back with `json_each`, so no SQL is built from UI strings.

use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

use crate::domain::account::AccountStatus;
use crate::AppError;

/// The version saved views store their filter under. Bump it (and migrate
/// stored views) when a change isn't backwards compatible.
pub const FILTER_VERSION: u32 = 1;

/// Values per list field (chips of one kind).
pub const MAX_FILTER_VALUES: usize = 50;
pub const MAX_QUERY_CHARS: usize = 200;
const MAX_ID_CHARS: usize = 64;
const MAX_VALUE_CHARS: usize = 200;
const MAX_DAYS: u32 = 3650;

/// Days without activity (an edit, "Mark verified", or using the password
/// from Vaultair) before an active account counts as Stale, then Dormant.
/// Must match `STALE_AFTER_DAYS` and `DORMANT_AFTER_DAYS` in the UI's
/// `labels.ts`, which shows the same status.
pub const STALE_AFTER_DAYS: u32 = 30;
pub const DORMANT_AFTER_DAYS: u32 = 90;

/// The status an account shows: the one the user set, except that an active
/// account with no recent activity shows as Stale, then Dormant. Archived
/// accounts keep the status they had.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum StatusFilter {
    Active,
    Stale,
    Dormant,
    Locked,
    Suspended,
    Retired,
    Unknown,
}

/// Narrows the account list. Every set field must match (AND); several
/// values in one list field match any of them (OR). `text` searches the
/// index: every word must appear in the account, or in one of its game
/// profiles.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountFilter {
    #[serde(default)]
    pub text: Option<String>,
    /// Archived accounts instead of active ones.
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub identity_ids: Vec<String>,
    #[serde(default)]
    pub purpose_ids: Vec<String>,
    #[serde(default)]
    pub platform_ids: Vec<String>,
    /// Also matches accounts with a game profile for the game.
    #[serde(default)]
    pub game_ids: Vec<String>,
    /// Compared case-insensitively.
    #[serde(default)]
    pub publishers: Vec<String>,
    #[serde(default)]
    pub statuses: Vec<StatusFilter>,
    /// Accounts with any of these tags, compared case-insensitively.
    #[serde(default)]
    pub tags: Vec<String>,
    /// At least one enabled MFA method (true) or none (false).
    #[serde(default)]
    pub mfa: Option<bool>,
    /// true: unused backup codes left. false: MFA is on but no backup codes
    /// are left (the "missing recovery codes" health rule).
    #[serde(default)]
    pub recovery_codes: Option<bool>,
    #[serde(default)]
    pub favorite: Option<bool>,
    /// Never marked verified, or not in this many days.
    #[serde(default)]
    pub not_verified_in_days: Option<u32>,
    /// Edited in the last this many days.
    #[serde(default)]
    pub updated_in_days: Option<u32>,
    /// The login email is some identity's primary email.
    #[serde(default)]
    pub uses_primary_email: bool,
    /// Favorites, and accounts with the Main or Recovery purpose (ADR-0004
    /// decision 19). Accounts with high-severity health issues join them
    /// once health checks exist (Phase 12).
    #[serde(default)]
    pub high_priority: bool,
}

/// Columns the list sorts by. `Activity` is the last activity (see
/// `AccountSummary::last_activity_at`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    #[default]
    Title,
    Identity,
    Purpose,
    Status,
    Updated,
    Activity,
    Created,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSort {
    pub key: SortKey,
    pub descending: bool,
}

/// What a saved view stores: a versioned filter and sort.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewSpec {
    pub v: u32,
    pub filter: AccountFilter,
    #[serde(default)]
    pub sort: AccountSort,
}

impl ViewSpec {
    /// Parses and validates a stored `filter_json`. Anything unexpected
    /// (another version, an unknown field, a bad value) is rejected.
    pub fn from_json(json: &str) -> Result<Self, AppError> {
        let spec: Self =
            serde_json::from_str(json).map_err(|_| AppError::InvalidInput { field: "filter" })?;
        spec.validated()
    }

    pub fn validated(mut self) -> Result<Self, AppError> {
        if self.v != FILTER_VERSION {
            return Err(AppError::InvalidInput { field: "filter" });
        }
        self.filter = self.filter.validated()?;
        Ok(self)
    }

    pub fn to_json(&self) -> String {
        // A plain struct of strings, numbers and enums: serializing can't fail.
        serde_json::to_string(self).unwrap_or_default()
    }
}

fn clean_list(values: &[String], max_chars: usize) -> Result<Vec<String>, AppError> {
    if values.len() > MAX_FILTER_VALUES {
        return Err(AppError::InvalidInput { field: "filter" });
    }
    let mut out: Vec<String> = Vec::with_capacity(values.len());
    for v in values {
        let v = v.trim();
        if v.is_empty() || v.chars().count() > max_chars || v.chars().any(char::is_control) {
            return Err(AppError::InvalidInput { field: "filter" });
        }
        if !out.iter().any(|o| o.eq_ignore_ascii_case(v)) {
            out.push(v.to_owned());
        }
    }
    Ok(out)
}

fn check_days(days: Option<u32>) -> Result<Option<u32>, AppError> {
    match days {
        Some(d) if d == 0 || d > MAX_DAYS => Err(AppError::InvalidInput { field: "filter" }),
        other => Ok(other),
    }
}

impl AccountFilter {
    /// Trims and de-duplicates values, and rejects anything out of range.
    pub fn validated(self) -> Result<Self, AppError> {
        let text = match self.text.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(t) if t.chars().count() > MAX_QUERY_CHARS || t.chars().any(char::is_control) => {
                return Err(AppError::InvalidInput { field: "filter" })
            }
            Some(t) => Some(t.to_owned()),
        };
        if self.statuses.len() > MAX_FILTER_VALUES {
            return Err(AppError::InvalidInput { field: "filter" });
        }
        let mut statuses: Vec<StatusFilter> = Vec::with_capacity(self.statuses.len());
        for s in self.statuses {
            if !statuses.contains(&s) {
                statuses.push(s);
            }
        }
        Ok(Self {
            text,
            archived: self.archived,
            identity_ids: clean_list(&self.identity_ids, MAX_ID_CHARS)?,
            purpose_ids: clean_list(&self.purpose_ids, MAX_ID_CHARS)?,
            platform_ids: clean_list(&self.platform_ids, MAX_ID_CHARS)?,
            game_ids: clean_list(&self.game_ids, MAX_ID_CHARS)?,
            publishers: clean_list(&self.publishers, MAX_VALUE_CHARS)?,
            statuses,
            tags: clean_list(&self.tags, MAX_VALUE_CHARS)?,
            mfa: self.mfa,
            recovery_codes: self.recovery_codes,
            favorite: self.favorite,
            not_verified_in_days: check_days(self.not_verified_in_days)?,
            updated_in_days: check_days(self.updated_in_days)?,
            uses_primary_email: self.uses_primary_email,
            high_priority: self.high_priority,
        })
    }
}

// ---- Compiling to SQL ---------------------------------------------------------

/// A WHERE clause over `account a` (joined as in the summary query) with
/// its parameters, numbered from `?1`.
#[derive(Debug)]
pub struct Compiled {
    pub sql: String,
    pub params: Vec<Value>,
}

impl Compiled {
    /// Appends `AND fragment`. Fragments mark each parameter `?#`; they're
    /// numbered here, in order, as `values` are added.
    pub(crate) fn push(&mut self, fragment: &str, values: impl IntoIterator<Item = Value>) {
        let mut fragment = fragment.to_owned();
        for value in values {
            self.params.push(value);
            fragment = fragment.replacen("?#", &format!("?{}", self.params.len()), 1);
        }
        debug_assert!(
            !fragment.contains("?#"),
            "a fragment has more markers than values"
        );
        self.sql.push_str(" AND ");
        self.sql.push_str(&fragment);
    }
}

fn json_list(values: &[String]) -> Value {
    Value::Text(serde_json::to_string(values).unwrap_or_else(|_| "[]".to_owned()))
}

/// `days` before `now`, in the stored timestamp format.
fn cutoff(now: time::OffsetDateTime, days: u32) -> Value {
    let then = now - time::Duration::days(i64::from(days));
    Value::Text(
        then.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned()),
    )
}

/// The latest of the last edit, "Mark verified" and last use.
const LAST_ACTIVITY: &str =
    "max(a.updated_at, COALESCE(a.last_verified_at, ''), COALESCE(a.last_used_at, ''))";

const HAS_MFA: &str =
    "EXISTS(SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1)";
const BACKUP_CODES: &str = "(SELECT COALESCE(SUM(m.backup_codes_remaining), 0) FROM mfa_method m
     WHERE m.account_id = a.id AND m.enabled = 1)";

/// Compiles a validated filter. `now` places Stale, Dormant and the
/// day-count filters.
pub fn compile(filter: &AccountFilter, now: time::OffsetDateTime) -> Compiled {
    let mut c = Compiled {
        sql: "(a.archived_at IS NOT NULL) = ?1".to_owned(),
        params: vec![Value::Integer(i64::from(filter.archived))],
    };
    if let Some(q) = filter
        .text
        .as_deref()
        .and_then(super::query::TextQuery::parse)
    {
        q.push_account_predicate(&mut c);
    }
    if !filter.identity_ids.is_empty() {
        c.push(
            "a.identity_id IN (SELECT value FROM json_each(?#))",
            [json_list(&filter.identity_ids)],
        );
    }
    if !filter.purpose_ids.is_empty() {
        c.push(
            "a.purpose_id IN (SELECT value FROM json_each(?#))",
            [json_list(&filter.purpose_ids)],
        );
    }
    if !filter.platform_ids.is_empty() {
        c.push(
            "a.platform_id IN (SELECT value FROM json_each(?#))",
            [json_list(&filter.platform_ids)],
        );
    }
    if !filter.game_ids.is_empty() {
        let games = json_list(&filter.game_ids);
        c.push(
            "(a.game_id IN (SELECT value FROM json_each(?#))
              OR EXISTS(SELECT 1 FROM game_profile gp WHERE gp.account_id = a.id
                        AND gp.game_id IN (SELECT value FROM json_each(?#))))",
            [games.clone(), games],
        );
    }
    if !filter.publishers.is_empty() {
        c.push(
            "EXISTS(SELECT 1 FROM json_each(?#) j
                    WHERE j.value = trim(a.publisher) COLLATE NOCASE)",
            [json_list(&filter.publishers)],
        );
    }
    if !filter.tags.is_empty() {
        // tag.name is COLLATE NOCASE, so the comparison is too.
        c.push(
            "EXISTS(SELECT 1 FROM account_tag x JOIN tag t ON t.id = x.tag_id
                    WHERE x.account_id = a.id
                      AND t.name IN (SELECT value FROM json_each(?#)))",
            [json_list(&filter.tags)],
        );
    }
    if !filter.statuses.is_empty() {
        push_statuses(&mut c, &filter.statuses, now);
    }
    if let Some(on) = filter.mfa {
        let sql = if on {
            HAS_MFA.to_owned()
        } else {
            format!("NOT {HAS_MFA}")
        };
        c.push(&sql, []);
    }
    if let Some(left) = filter.recovery_codes {
        let sql = if left {
            format!("{BACKUP_CODES} > 0")
        } else {
            format!("{HAS_MFA} AND {BACKUP_CODES} = 0")
        };
        c.push(&sql, []);
    }
    if let Some(fav) = filter.favorite {
        c.push("a.favorite = ?#", [Value::Integer(i64::from(fav))]);
    }
    if let Some(days) = filter.not_verified_in_days {
        c.push(
            "(a.last_verified_at IS NULL OR a.last_verified_at < ?#)",
            [cutoff(now, days)],
        );
    }
    if let Some(days) = filter.updated_in_days {
        c.push("a.updated_at >= ?#", [cutoff(now, days)]);
    }
    if filter.uses_primary_email {
        c.push(
            "EXISTS(SELECT 1 FROM identity pi WHERE pi.primary_email IS NOT NULL
                    AND lower(trim(pi.primary_email)) = lower(trim(a.email)))",
            [],
        );
    }
    if filter.high_priority {
        c.push(
            "(a.favorite = 1 OR a.purpose_id IN
                (SELECT id FROM purpose_label WHERE slug IN ('main', 'recovery')))",
            [],
        );
    }
    c
}

/// Any of the chosen statuses. Stale and Dormant are worked out from the
/// last activity for active, unarchived accounts, as the UI shows them.
fn push_statuses(c: &mut Compiled, statuses: &[StatusFilter], now: time::OffsetDateTime) {
    let derived = "a.status = 'active' AND a.archived_at IS NULL";
    let mut parts: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for s in statuses {
        match s {
            StatusFilter::Active => {
                parts.push(format!(
                    "(a.status = 'active' AND (a.archived_at IS NOT NULL OR {LAST_ACTIVITY} >= ?#))"
                ));
                values.push(cutoff(now, STALE_AFTER_DAYS));
            }
            StatusFilter::Stale => {
                parts.push(format!(
                    "({derived} AND {LAST_ACTIVITY} < ?# AND {LAST_ACTIVITY} >= ?#)"
                ));
                values.push(cutoff(now, STALE_AFTER_DAYS));
                values.push(cutoff(now, DORMANT_AFTER_DAYS));
            }
            StatusFilter::Dormant => {
                parts.push(format!(
                    "(a.status = 'dormant' OR ({derived} AND {LAST_ACTIVITY} < ?#))"
                ));
                values.push(cutoff(now, DORMANT_AFTER_DAYS));
            }
            StatusFilter::Locked => parts.push(set_status(AccountStatus::Locked)),
            StatusFilter::Suspended => parts.push(set_status(AccountStatus::Suspended)),
            StatusFilter::Retired => parts.push(set_status(AccountStatus::Retired)),
            StatusFilter::Unknown => parts.push(set_status(AccountStatus::Unknown)),
        }
    }
    c.push(&format!("({})", parts.join(" OR ")), values);
}

/// `as_str` is one of the enum's fixed names, never user text.
fn set_status(status: AccountStatus) -> String {
    format!("a.status = '{}'", status.as_str())
}

impl SortKey {
    /// The ORDER BY clause, ending with the id so the order is total.
    pub fn order_by(self, descending: bool) -> String {
        let dir = if descending { "DESC" } else { "ASC" };
        let title = "a.title COLLATE NOCASE";
        match self {
            Self::Title => format!("{title} {dir}, a.id {dir}"),
            // Accounts without an identity sort last either way.
            Self::Identity => {
                format!("i.name IS NULL, i.name COLLATE NOCASE {dir}, {title}, a.id")
            }
            Self::Purpose => {
                format!("p.sort_order {dir}, p.name COLLATE NOCASE {dir}, {title}, a.id")
            }
            Self::Status => format!("a.status {dir}, {LAST_ACTIVITY} {dir}, {title}, a.id"),
            Self::Updated => format!("a.updated_at {dir}, a.id {dir}"),
            Self::Activity => format!("{LAST_ACTIVITY} {dir}, a.id {dir}"),
            Self::Created => format!("a.created_at {dir}, a.id {dir}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_specs_round_trip() {
        let spec = ViewSpec {
            v: FILTER_VERSION,
            filter: AccountFilter {
                purpose_ids: vec!["builtin-main".into()],
                statuses: vec![StatusFilter::Dormant],
                mfa: Some(false),
                ..AccountFilter::default()
            },
            sort: AccountSort {
                key: SortKey::Updated,
                descending: true,
            },
        };
        assert_eq!(ViewSpec::from_json(&spec.to_json()).unwrap(), spec);
    }

    #[test]
    fn a_minimal_spec_fills_in_defaults() {
        let spec = ViewSpec::from_json(r#"{"v":1,"filter":{"favorite":true}}"#).unwrap();
        assert_eq!(spec.filter.favorite, Some(true));
        assert_eq!(spec.sort, AccountSort::default());
    }

    #[test]
    fn invalid_specs_are_rejected() {
        for bad in [
            "",
            "not json",
            "[]",
            r#"{"v":2,"filter":{}}"#,
            r#"{"filter":{}}"#,
            r#"{"v":1,"filter":{},"extra":1}"#,
            r#"{"v":1,"filter":{"sql":"1=1"}}"#,
            r#"{"v":1,"filter":{"statuses":["deleted"]}}"#,
            r#"{"v":1,"filter":{"mfa":"yes"}}"#,
            r#"{"v":1,"filter":{"platformIds":[""]}}"#,
            r#"{"v":1,"filter":{"updatedInDays":0}}"#,
            r#"{"v":1,"filter":{"updatedInDays":-3}}"#,
            r#"{"v":1,"filter":{},"sort":{"key":"password","descending":false}}"#,
        ] {
            assert!(ViewSpec::from_json(bad).is_err(), "accepted {bad}");
        }
        let too_many = AccountFilter {
            tags: (0..=MAX_FILTER_VALUES).map(|i| format!("t{i}")).collect(),
            ..AccountFilter::default()
        };
        assert!(too_many.validated().is_err());
        let long = AccountFilter {
            text: Some("x".repeat(MAX_QUERY_CHARS + 1)),
            ..AccountFilter::default()
        };
        assert!(long.validated().is_err());
    }

    #[test]
    fn validation_trims_and_dedupes() {
        let f = AccountFilter {
            text: Some("   ".into()),
            tags: vec![" Ranked ".into(), "ranked".into(), "EU".into()],
            statuses: vec![
                StatusFilter::Stale,
                StatusFilter::Locked,
                StatusFilter::Stale,
            ],
            ..AccountFilter::default()
        }
        .validated()
        .unwrap();
        assert_eq!(f.text, None);
        assert_eq!(f.tags, vec!["Ranked".to_owned(), "EU".to_owned()]);
        assert_eq!(f.statuses, vec![StatusFilter::Stale, StatusFilter::Locked]);
    }

    #[test]
    fn compiled_sql_only_binds_user_values() {
        let f = AccountFilter {
            text: Some("x'; DROP TABLE account; --".into()),
            publishers: vec!["Riot'--".into()],
            tags: vec!["a\"b".into()],
            statuses: vec![StatusFilter::Stale, StatusFilter::Locked],
            not_verified_in_days: Some(30),
            ..AccountFilter::default()
        }
        .validated()
        .unwrap();
        let c = compile(&f, time::OffsetDateTime::UNIX_EPOCH);
        assert!(!c.sql.contains("DROP"));
        assert!(!c.sql.contains("Riot"));
        assert!(!c.sql.contains("a\"b"));
        assert!(!c.sql.contains("?#"));
        // Every placeholder has a value, and every value a placeholder.
        let n = c.params.len();
        assert!(c.sql.contains(&format!("?{n}")));
        assert!(!c.sql.contains(&format!("?{}", n + 1)));
    }
}
