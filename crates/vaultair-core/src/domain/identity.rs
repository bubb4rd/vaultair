//! Identities (a persona that owns many accounts) and contact points (the
//! emails and phones accounts sign in and recover through).

use serde::{Deserialize, Serialize};

use crate::domain::account::{text_enum, AccountStatus, AccountSummary, AccountType};
use crate::domain::health::HealthIssue;

text_enum!(
    /// What a contact point is. Only emails and phones are created in the
    /// MVP; the others are reserved by the schema for MFA devices.
    ContactKind {
        Email => "email",
        Phone => "phone",
        AuthenticatorApp => "authenticator_app",
        HardwareKey => "hardware_key",
        Other => "other",
    }
);

text_enum!(
    /// How an account uses a contact point.
    ContactRole {
        LoginEmail => "login_email",
        RecoveryEmail => "recovery_email",
        RecoveryPhone => "recovery_phone",
        Authenticator => "authenticator",
        HardwareKey => "hardware_key",
        Other => "other",
    }
);

text_enum!(
    /// An identity's accent. A fixed palette so the UI can map each name to a
    /// token that reads well on the dark theme; status colours are never used.
    IdentityColor {
        Blue => "blue",
        Violet => "violet",
        Teal => "teal",
        Amber => "amber",
        Rose => "rose",
        Slate => "slate",
    }
);

/// The one normalization for contact values, so `Me@Example.com` and
/// `me@example.com ` are the same contact point. ASCII-only lowercasing on
/// purpose: SQLite's `lower()` does the same, so SQL and Rust always agree
/// (the V3 backfill relies on it). The input is already trimmed by
/// validation; trimming again keeps this safe to call on anything.
pub fn normalize_contact(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

/// Everything the identity form edits. Sent whole on create and update.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IdentityInput {
    pub name: String,
    pub description: Option<String>,
    pub primary_email: Option<String>,
    pub recovery_email: Option<String>,
    /// A phone reference such as "Pixel, ends 42" (ADR-0004 decision 12).
    /// A full number is allowed but not asked for.
    pub phone_ref: Option<String>,
    pub notes: Option<String>,
    pub color: Option<IdentityColor>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A row in the identity list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IdentitySummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub primary_email: Option<String>,
    pub color: Option<IdentityColor>,
    /// Active (not archived) accounts assigned to it.
    pub account_count: u32,
    /// Of those, how many have no enabled MFA method.
    pub accounts_without_mfa: u32,
    pub archived_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IdentityDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub primary_email: Option<String>,
    pub recovery_email: Option<String>,
    pub phone_ref: Option<String>,
    pub notes: Option<String>,
    pub color: Option<IdentityColor>,
    pub tags: Vec<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The identity choices an account form or filter offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IdentityRef {
    pub id: String,
    pub name: String,
    pub color: Option<IdentityColor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ContactPointView {
    pub id: String,
    pub kind: ContactKind,
    /// As first entered (an email is shown lowercased either way).
    pub value: String,
    pub label: Option<String>,
    /// The identity that declared it (its primary or recovery email, or phone).
    pub identity_id: Option<String>,
    /// Distinct active accounts linked to it in any role, across the vault.
    pub account_count: u32,
}

/// An account as the overview lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OverviewAccount {
    pub id: String,
    pub title: String,
    pub account_type: AccountType,
    pub status: AccountStatus,
    pub purpose_name: String,
    pub mfa_enabled: bool,
}

/// Accounts sharing a platform. `platform` is the platform's name, or the
/// publisher until platforms are cataloged (Phase 10); `None` groups the rest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlatformGroup {
    pub platform: Option<String>,
    pub accounts: Vec<OverviewAccount>,
}

/// An email one or more of the identity's accounts sign in or recover with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SharedEmail {
    pub contact: ContactPointView,
    /// This identity's accounts using it, by title.
    pub accounts: Vec<OverviewAccount>,
}

/// Whether the mailbox behind an email is itself protected. Anyone who gets
/// into the mailbox can reset every account that recovers through it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum MailboxSecurity {
    /// Every email account in the vault that signs in with it has MFA on.
    MfaOn,
    /// At least one of them has no enabled MFA method.
    NoMfa,
    /// No email-type account in the vault signs in with it, so Vaultair
    /// can't tell.
    NotInVault,
    /// A phone, not a mailbox.
    NotApplicable,
}

/// An account that depends on a contact point, and how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Dependent {
    pub account: OverviewAccount,
    pub role: ContactRole,
}

/// One recovery route: an email or phone, the accounts that could be reset
/// through it, and whether the mailbox itself has MFA.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDependency {
    pub contact: ContactPointView,
    pub mailbox: MailboxSecurity,
    /// The mailbox accounts behind an email (email-type accounts signing in
    /// with it), anywhere in the vault.
    pub mailbox_accounts: Vec<OverviewAccount>,
    pub dependents: Vec<Dependent>,
}

/// Everything the identity page shows beyond the identity's own fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IdentityOverview {
    pub identity: IdentityDetail,
    pub account_count: u32,
    pub groups: Vec<PlatformGroup>,
    /// Distinct platform (or publisher) names, alphabetically.
    pub platforms: Vec<String>,
    pub shared_emails: Vec<SharedEmail>,
    /// Recovery emails and phones (not login emails) the accounts use.
    pub recovery_methods: Vec<ContactPointView>,
    pub dependencies: Vec<RecoveryDependency>,
}

/// What happens to an identity's accounts when it's deleted.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum IdentityDeletePlan {
    /// The accounts stay, with no identity.
    Unassign,
    /// The accounts move to another identity.
    Reassign {
        #[serde(rename = "identityId")]
        identity_id: String,
    },
}

/// The dashboard's numbers, optionally for one identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    /// The identity the numbers are for; `None` means the whole vault.
    pub identity_id: Option<String>,
    pub total_accounts: u32,
    pub main_accounts: u32,
    pub alt_accounts: u32,
    /// Active identities (for one identity: 1).
    pub identities: u32,
    pub missing_mfa: u32,
    pub favorites: u32,
    /// The five most recently edited accounts.
    pub recent: Vec<AccountSummary>,
    /// Active accounts with a weak password (strength 0 or 1).
    pub weak: u32,
    /// Active accounts sharing a password with another active account.
    pub reused: u32,
    /// MFA is on and no backup codes are left.
    pub missing_recovery_codes: u32,
    /// Saved status dormant, or active with no activity for 90 days.
    pub dormant: u32,
    /// Up to five issues, highest severity first.
    pub needs_attention: Vec<HealthIssue>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_folds_case_and_whitespace_only() {
        assert_eq!(normalize_contact("  Me@Example.COM "), "me@example.com");
        assert_eq!(normalize_contact("Pixel, ends 42"), "pixel, ends 42");
        // Non-ASCII is left alone, matching SQLite's lower().
        assert_eq!(normalize_contact("ÉLAN@example.com"), "Élan@example.com");
    }

    #[test]
    fn delete_plan_deserializes_from_tagged_json() {
        let plan: IdentityDeletePlan =
            serde_json::from_str(r#"{"action":"reassign","identityId":"i2"}"#).unwrap();
        assert_eq!(
            plan,
            IdentityDeletePlan::Reassign {
                identity_id: "i2".into()
            }
        );
        let plan: IdentityDeletePlan = serde_json::from_str(r#"{"action":"unassign"}"#).unwrap();
        assert_eq!(plan, IdentityDeletePlan::Unassign);
    }
}
