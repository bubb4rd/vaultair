//! Health-check results. These name an account and a rule. They never carry
//! a password, a fingerprint, or a backup code.

use serde::{Deserialize, Serialize};

/// Which check found the issue. Also the optional filter on `health_issues`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum HealthRule {
    Weak,
    Reused,
    MissingMfa,
    MissingRecoveryCodes,
    Dormant,
}

/// How serious the issue is. High is weak and reused passwords; those are
/// what the High-priority saved view adds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum HealthSeverity {
    High,
    Medium,
    Low,
    Info,
}

/// Where "Fix" goes. The account id is on the issue; this is only the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum HealthFix {
    /// The account form, where the password is changed.
    EditAccount,
    /// The account page, scrolled to the MFA section.
    MfaSection,
    /// The account page. Mark verified clears an activity-based dormant issue.
    Account,
}

/// One problem on one active account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
    pub account_id: String,
    pub title: String,
    pub rule: HealthRule,
    pub severity: HealthSeverity,
    pub reason: String,
    pub fix: HealthFix,
}

/// How many active accounts each rule matches, for the whole vault or one
/// identity. Reuse is counted across the whole vault: an account is reused
/// when any other active account shares its password, including one outside
/// the identity filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HealthSummary {
    /// The identity the numbers are for; `None` means the whole vault.
    pub identity_id: Option<String>,
    pub weak: u32,
    pub reused: u32,
    pub missing_mfa: u32,
    pub missing_recovery_codes: u32,
    pub dormant: u32,
}
