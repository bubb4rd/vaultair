//! The five health rules, as SQL over active accounts, and the issue list
//! they produce.
//!
//! Archived accounts are left out. A password shared only with an archived
//! account is not reused. Fingerprints are compared inside SQL and never
//! selected.

use rusqlite::{params, Connection};

use crate::domain::health::{HealthFix, HealthIssue, HealthRule, HealthSeverity, HealthSummary};
use crate::health::thresholds::{DORMANT_AFTER_DAYS, WEAK_AT_OR_BELOW};
use crate::AppError;

/// The latest of the last edit, "Mark verified" and last use. The account
/// list's Stale and Dormant filters use this same expression.
pub const LAST_ACTIVITY: &str =
    "max(a.updated_at, COALESCE(a.last_verified_at, ''), COALESCE(a.last_used_at, ''))";

/// Active accounts whose saved password scores at or below [`WEAK_AT_OR_BELOW`].
pub fn weak_predicate() -> String {
    format!("(a.password_strength IS NOT NULL AND a.password_strength <= {WEAK_AT_OR_BELOW})")
}

/// Active accounts whose password fingerprint is shared with at least one
/// other active account. The comparison stays in SQL.
pub fn reused_predicate() -> &'static str {
    "(a.password_fp IS NOT NULL AND (
        SELECT COUNT(*) FROM account other
        WHERE other.archived_at IS NULL AND other.password_fp = a.password_fp
    ) > 1)"
}

/// Saved status dormant, or active and idle for longer than
/// [`DORMANT_AFTER_DAYS`]. `?#` is the cutoff timestamp. Same predicate as
/// the list's Dormant status filter.
pub fn dormant_predicate() -> String {
    format!(
        "(a.status = 'dormant' OR (a.status = 'active' AND a.archived_at IS NULL AND {LAST_ACTIVITY} < ?#))"
    )
}

/// Weak or reused. What the High-priority saved view adds to favorites and
/// the Main and Recovery purposes.
pub fn high_severity_predicate() -> String {
    format!("({} OR {})", weak_predicate(), reused_predicate())
}

const NOT_ARCHIVED: &str = "a.archived_at IS NULL AND (?1 IS NULL OR a.identity_id = ?1)";

const MISSING_MFA: &str =
    "NOT EXISTS(SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1)";

const MISSING_CODES: &str =
    "EXISTS(SELECT 1 FROM mfa_method m WHERE m.account_id = a.id AND m.enabled = 1)
     AND (SELECT COALESCE(SUM(m.backup_codes_remaining), 0) FROM mfa_method m
           WHERE m.account_id = a.id AND m.enabled = 1) = 0";

fn count(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

/// `now` minus the dormant cutoff, in the stored timestamp format.
fn cutoff(now: time::OffsetDateTime) -> String {
    let then = now - time::Duration::days(i64::from(DORMANT_AFTER_DAYS));
    then.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

/// Counts for each rule. `identity_id` limits which accounts are counted;
/// reuse still looks at every active account in the vault.
pub fn summary(
    conn: &Connection,
    identity_id: Option<&str>,
    now: time::OffsetDateTime,
) -> Result<HealthSummary, AppError> {
    let weak = weak_predicate();
    let reused = reused_predicate();
    let dormant = dormant_predicate().replace("?#", "?2");
    let sql = format!(
        "SELECT COALESCE(SUM(({weak})), 0),
                COALESCE(SUM(({reused})), 0),
                COALESCE(SUM(({MISSING_MFA})), 0),
                COALESCE(SUM(({MISSING_CODES})), 0),
                COALESCE(SUM(({dormant})), 0)
         FROM account a
         WHERE {NOT_ARCHIVED}"
    );
    conn.query_row(&sql, params![identity_id, cutoff(now)], |r| {
        Ok(HealthSummary {
            identity_id: identity_id.map(str::to_owned),
            weak: count(r.get(0)?),
            reused: count(r.get(1)?),
            missing_mfa: count(r.get(2)?),
            missing_recovery_codes: count(r.get(3)?),
            dormant: count(r.get(4)?),
        })
    })
    .map_err(AppError::from)
}

/// Every matching issue, highest severity first. `rule` keeps one check.
pub fn issues(
    conn: &Connection,
    identity_id: Option<&str>,
    rule: Option<HealthRule>,
    now: time::OffsetDateTime,
) -> Result<Vec<HealthIssue>, AppError> {
    let mut out = Vec::new();
    let want = |r: HealthRule| rule.is_none_or(|w| w == r);
    if want(HealthRule::Weak) {
        push_simple(
            conn,
            &mut out,
            HealthRule::Weak,
            &weak_predicate(),
            identity_id,
            "This password is weak.",
        )?;
    }
    if want(HealthRule::Reused) {
        push_reused(conn, &mut out, identity_id)?;
    }
    if want(HealthRule::MissingMfa) {
        push_simple(
            conn,
            &mut out,
            HealthRule::MissingMfa,
            MISSING_MFA,
            identity_id,
            "No MFA is turned on.",
        )?;
    }
    if want(HealthRule::MissingRecoveryCodes) {
        push_simple(
            conn,
            &mut out,
            HealthRule::MissingRecoveryCodes,
            MISSING_CODES,
            identity_id,
            "MFA is on, but no backup codes are saved.",
        )?;
    }
    if want(HealthRule::Dormant) {
        push_dormant(conn, &mut out, identity_id, &cutoff(now))?;
    }
    out.sort_by(|a, b| {
        rank(a.severity)
            .cmp(&rank(b.severity))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
            .then(a.account_id.cmp(&b.account_id))
            .then(rule_rank(a.rule).cmp(&rule_rank(b.rule)))
    });
    Ok(out)
}

fn push_simple(
    conn: &Connection,
    out: &mut Vec<HealthIssue>,
    rule: HealthRule,
    predicate: &str,
    identity_id: Option<&str>,
    reason: &str,
) -> Result<(), AppError> {
    let sql = format!("SELECT a.id, a.title FROM account a WHERE {NOT_ARCHIVED} AND ({predicate})");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![identity_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    for row in rows {
        let (id, title): (String, String) = row?;
        out.push(issue(id, title, rule, reason.to_owned()));
    }
    Ok(())
}

fn push_reused(
    conn: &Connection,
    out: &mut Vec<HealthIssue>,
    identity_id: Option<&str>,
) -> Result<(), AppError> {
    let reused = reused_predicate();
    // The count is every active account sharing the fingerprint, including
    // this one. The reason reports the others. The fingerprint itself is
    // not selected.
    let sql = format!(
        "SELECT a.id, a.title,
                (SELECT COUNT(*) FROM account other
                  WHERE other.archived_at IS NULL AND other.password_fp = a.password_fp)
         FROM account a
         WHERE {NOT_ARCHIVED} AND {reused}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![identity_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)?))
    })?;
    for row in rows {
        let (id, title, n): (String, String, i64) = row?;
        let others = n.saturating_sub(1).max(1);
        let reason = if others == 1 {
            "Same password as 1 other account.".to_owned()
        } else {
            format!("Same password as {others} other accounts.")
        };
        out.push(issue(id, title, HealthRule::Reused, reason));
    }
    Ok(())
}

fn push_dormant(
    conn: &Connection,
    out: &mut Vec<HealthIssue>,
    identity_id: Option<&str>,
    cutoff_at: &str,
) -> Result<(), AppError> {
    let predicate = dormant_predicate().replace("?#", "?2");
    let sql = format!(
        "SELECT a.id, a.title, a.status = 'dormant'
         FROM account a
         WHERE {NOT_ARCHIVED} AND {predicate}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![identity_id, cutoff_at], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get::<_, bool>(2)?))
    })?;
    for row in rows {
        let (id, title, marked): (String, String, bool) = row?;
        let reason = if marked {
            "Marked dormant.".to_owned()
        } else {
            format!("No activity for {DORMANT_AFTER_DAYS} days or more.")
        };
        out.push(issue(id, title, HealthRule::Dormant, reason));
    }
    Ok(())
}

fn issue(id: String, title: String, rule: HealthRule, reason: String) -> HealthIssue {
    HealthIssue {
        account_id: id,
        title,
        severity: severity(rule),
        fix: fix_for(rule),
        rule,
        reason,
    }
}

fn severity(rule: HealthRule) -> HealthSeverity {
    match rule {
        HealthRule::Weak | HealthRule::Reused => HealthSeverity::High,
        HealthRule::MissingMfa => HealthSeverity::Medium,
        HealthRule::MissingRecoveryCodes => HealthSeverity::Low,
        HealthRule::Dormant => HealthSeverity::Info,
    }
}

fn fix_for(rule: HealthRule) -> HealthFix {
    match rule {
        HealthRule::Weak | HealthRule::Reused => HealthFix::EditAccount,
        HealthRule::MissingMfa | HealthRule::MissingRecoveryCodes => HealthFix::MfaSection,
        HealthRule::Dormant => HealthFix::Account,
    }
}

fn rank(severity: HealthSeverity) -> u8 {
    match severity {
        HealthSeverity::High => 0,
        HealthSeverity::Medium => 1,
        HealthSeverity::Low => 2,
        HealthSeverity::Info => 3,
    }
}

fn rule_rank(rule: HealthRule) -> u8 {
    match rule {
        HealthRule::Weak => 0,
        HealthRule::Reused => 1,
        HealthRule::MissingMfa => 2,
        HealthRule::MissingRecoveryCodes => 3,
        HealthRule::Dormant => 4,
    }
}
