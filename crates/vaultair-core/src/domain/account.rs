//! Accounts: enums (mirroring the schema's CHECK constraints), the input the
//! UI sends, and how secret fields are addressed and updated.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Declares a string enum stored as TEXT: serde names, `as_str` for SQL and
/// `parse` for reading rows back.
macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[cfg_attr(feature = "specta", derive(specta::Type))]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }

            pub fn parse(s: &str) -> Option<Self> {
                match s { $($text => Some(Self::$variant),)+ _ => None }
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(v: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                Self::parse(v.as_str()?).ok_or(rusqlite::types::FromSqlError::InvalidType)
            }
        }

        impl rusqlite::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }
    };
}
pub(crate) use text_enum;

text_enum!(
    /// What kind of login this is.
    AccountType {
        Platform => "platform",
        Launcher => "launcher",
        Game => "game",
        Console => "console",
        Social => "social",
        Streaming => "streaming",
        Email => "email",
        Website => "website",
        App => "app",
        Other => "other",
    }
);

text_enum!(
    /// Where the account stands. Archiving is separate (`archived_at`), so
    /// an archived account keeps the status it had.
    AccountStatus {
        Active => "active",
        Dormant => "dormant",
        Locked => "locked",
        Suspended => "suspended",
        Retired => "retired",
        Archived => "archived",
        Unknown => "unknown",
    }
);

text_enum!(
    /// Custom field kinds. `Secret` values are stored as field envelopes and
    /// behave like the password: hidden, revealed or copied on request.
    CustomFieldType {
        Text => "text",
        Secret => "secret",
        Url => "url",
        Email => "email",
        Number => "number",
        Date => "date",
    }
);

/// How an edit changes a secret. The UI never receives stored secrets, so
/// "leave it alone" has to be said explicitly.
#[derive(Clone, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum SecretUpdate {
    /// Keep what's stored (or store nothing, on create).
    #[default]
    Unchanged,
    Set {
        value: String,
    },
    Clear,
}

impl fmt::Debug for SecretUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unchanged => f.write_str("Unchanged"),
            Self::Set { .. } => f.write_str("Set([redacted])"),
            Self::Clear => f.write_str("Clear"),
        }
    }
}

impl Drop for SecretUpdate {
    fn drop(&mut self) {
        if let Self::Set { value } = self {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

/// A custom field as the form sends it. `id` is `None` for a new field.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldInput {
    pub id: Option<String>,
    pub label: String,
    pub field_type: CustomFieldType,
    /// The value for every type except `Secret`.
    pub value: Option<String>,
    /// The value for `Secret`.
    #[serde(default)]
    pub secret: SecretUpdate,
}

/// Everything the account form edits. Sent whole on create and update.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub title: String,
    pub account_type: AccountType,
    pub purpose_id: String,
    pub status: AccountStatus,
    /// The identity it belongs to, if any.
    pub identity_id: Option<String>,
    pub username: Option<String>,
    /// The login email. Saving upserts it as a contact point.
    pub email: Option<String>,
    #[serde(default)]
    pub password: SecretUpdate,
    /// Where a password reset goes, if not the login email.
    pub recovery_email: Option<String>,
    /// A phone reference such as "Pixel, ends 42" (ADR-0004 decision 12).
    pub recovery_phone: Option<String>,
    pub website_url: Option<String>,
    pub login_url: Option<String>,
    /// The catalog platform it's on (Steam, Battle.net...), if any.
    pub platform_id: Option<String>,
    /// The catalog game it's for, if any.
    pub game_id: Option<String>,
    pub publisher: Option<String>,
    pub region: Option<String>,
    pub player_id: Option<String>,
    pub display_name: Option<String>,
    /// Plain notes. Indexed for search.
    pub notes: Option<String>,
    /// Encrypted and never indexed.
    #[serde(default)]
    pub sensitive_notes: SecretUpdate,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub custom_fields: Vec<CustomFieldInput>,
}

/// Addresses one stored secret for `secret_reveal` and `clipboard_copy_secret`.
/// The UI names the cell; Rust decrypts it. `id` is the owning row's id.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SecretRef {
    AccountPassword {
        id: String,
    },
    SensitiveNotes {
        id: String,
    },
    /// A custom field of type `Secret`; `id` is the field's id.
    CustomField {
        id: String,
    },
    /// The TOTP setup key of an MFA method.
    TotpSecret {
        id: String,
    },
    /// The current TOTP code of an MFA method.
    TotpCode {
        id: String,
    },
    RecoveryInstructions {
        id: String,
    },
    /// One backup code, by position.
    BackupCode {
        id: String,
        index: u32,
    },
}

impl SecretRef {
    /// A short, data-free name for logs.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::AccountPassword { .. } => "account password",
            Self::SensitiveNotes { .. } => "sensitive notes",
            Self::CustomField { .. } => "custom field",
            Self::TotpSecret { .. } => "totp secret",
            Self::TotpCode { .. } => "totp code",
            Self::RecoveryInstructions { .. } => "recovery instructions",
            Self::BackupCode { .. } => "backup code",
        }
    }
}

/// Which stored URL "Open in browser" uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum AccountUrl {
    Website,
    Login,
}

// ---- What the UI receives ----------------------------------------------
//
// These carry flags about secrets (`has_password`, `password_strength`),
// never the secrets. The only types that carry a secret value are
// `RevealedSecret` and `TotpCodeView`, returned by the reveal commands.

text_enum!(
    /// A purpose label's colour: the identity palette, so the UI maps each
    /// name to a token that reads well on the dark theme. Never a status
    /// colour, and never the only cue (the name is always shown).
    PurposeColor {
        Blue => "blue",
        Violet => "violet",
        Teal => "teal",
        Amber => "amber",
        Rose => "rose",
        Slate => "slate",
    }
);

/// A purpose label. Hidden ones are listed too: accounts that already use
/// one keep showing it, but forms don't offer it for new picks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PurposeView {
    pub id: String,
    /// Stable: built-in slugs are what the High-priority view and dashboard
    /// counts match on, and a custom label keeps its slug when renamed.
    pub slug: String,
    pub name: String,
    pub is_builtin: bool,
    pub is_hidden: bool,
    pub color: Option<PurposeColor>,
    /// Accounts using it, archived ones included (a delete has to move them all).
    pub account_count: u32,
}

/// What the purpose label editor sends on create and update.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PurposeInput {
    /// Built-ins keep their name: anything else is rejected on update.
    pub name: String,
    pub color: Option<PurposeColor>,
}

/// A row in the account list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub title: String,
    pub account_type: AccountType,
    pub purpose_id: String,
    pub purpose_name: String,
    pub status: AccountStatus,
    pub identity_id: Option<String>,
    pub identity_name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub platform_id: Option<String>,
    pub platform_name: Option<String>,
    /// The platform's bundled logo, if it has one.
    pub platform_icon: Option<String>,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
    /// The game's bundled logo, if it has one.
    pub game_icon: Option<String>,
    pub publisher: Option<String>,
    pub has_password: bool,
    /// zxcvbn score 0–4 of the stored password, computed when it was saved.
    pub password_strength: Option<u8>,
    /// At least one enabled MFA method.
    pub mfa_enabled: bool,
    /// Unused backup codes across enabled MFA methods.
    pub backup_codes_remaining: u32,
    pub favorite: bool,
    pub favorited_at: Option<String>,
    pub archived_at: Option<String>,
    pub tags: Vec<String>,
    pub updated_at: String,
    /// The latest of the last edit, "Mark verified" and the last use of the
    /// password from Vaultair. The UI turns it into Active, Stale or Dormant.
    pub last_activity_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldView {
    pub id: String,
    pub label: String,
    pub field_type: CustomFieldType,
    /// The value for every type except `Secret`, which is always `None` here.
    pub value: Option<String>,
    pub has_value: bool,
}

/// One backup code's slot: its position and whether it's used. The code
/// itself is only revealed or copied on request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupCodeSlot {
    pub index: u32,
    pub used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MfaView {
    pub id: String,
    pub method: crate::domain::mfa::MfaMethod,
    pub enabled: bool,
    pub has_totp: bool,
    pub totp_digits: Option<u8>,
    pub totp_period: Option<u32>,
    pub backup_codes: Vec<BackupCodeSlot>,
    pub backup_codes_remaining: u32,
    pub backup_codes_updated_at: Option<String>,
    pub has_recovery_instructions: bool,
    pub notes: Option<String>,
    pub updated_at: String,
}

/// Everything the detail page shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AccountDetail {
    pub id: String,
    pub title: String,
    pub account_type: AccountType,
    pub purpose_id: String,
    pub purpose_name: String,
    pub status: AccountStatus,
    pub identity_id: Option<String>,
    pub identity_name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub recovery_email: Option<String>,
    pub recovery_phone: Option<String>,
    pub has_password: bool,
    pub password_strength: Option<u8>,
    pub password_changed_at: Option<String>,
    pub website_url: Option<String>,
    pub login_url: Option<String>,
    /// The platform's catalog login page, offered when `login_url` is empty.
    pub catalog_login_url: Option<String>,
    pub platform_id: Option<String>,
    pub platform_name: Option<String>,
    pub platform_icon: Option<String>,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
    pub game_icon: Option<String>,
    pub publisher: Option<String>,
    pub region: Option<String>,
    pub player_id: Option<String>,
    pub display_name: Option<String>,
    pub notes: Option<String>,
    pub has_sensitive_notes: bool,
    /// Account details the sensitive notes seem to hold, to suggest moving
    /// to their own fields (ADR-0006). Flags only, never the text.
    pub notes_suggestions: crate::domain::notes_hints::NotesSuggestions,
    pub favorite: bool,
    pub archived_at: Option<String>,
    pub last_verified_at: Option<String>,
    /// When the password was last revealed or copied from Vaultair.
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// The latest of the last edit, "Mark verified" and the last use of the
    /// password from Vaultair. The UI turns it into Active, Stale or Dormant.
    pub last_activity_at: String,
    pub tags: Vec<String>,
    pub custom_fields: Vec<CustomFieldView>,
    pub mfa: Vec<MfaView>,
}

/// A decrypted secret, returned only by `secret_reveal`. Deliberately the
/// one serializable wrapper around a secret value; `Debug` hides it.
#[derive(Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RevealedSecret {
    pub value: String,
}

impl fmt::Debug for RevealedSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RevealedSecret([redacted])")
    }
}

impl Drop for RevealedSecret {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.value);
    }
}

/// The current TOTP code, for display with a countdown.
#[derive(Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TotpCodeView {
    pub code: String,
    pub seconds_remaining: u32,
    pub period: u32,
}

impl fmt::Debug for TotpCodeView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TotpCodeView")
            .field("code", &"[redacted]")
            .field("seconds_remaining", &self.seconds_remaining)
            .finish()
    }
}

impl Drop for TotpCodeView {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.code);
    }
}

/// A stored URL checked again before it's opened, with the host the
/// confirm dialog shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UrlTarget {
    pub url: String,
    pub host: String,
    /// The login page came from the platform catalog, not the account.
    pub from_catalog: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_enums_round_trip_through_their_sql_names() {
        for t in AccountType::ALL {
            assert_eq!(AccountType::parse(t.as_str()), Some(*t));
        }
        for s in AccountStatus::ALL {
            assert_eq!(AccountStatus::parse(s.as_str()), Some(*s));
        }
        assert_eq!(AccountType::parse("smurf"), None);
        assert_eq!(
            serde_json::to_value(AccountType::Launcher).unwrap(),
            "launcher"
        );
    }

    #[test]
    fn secret_update_never_prints_its_value() {
        let set: SecretUpdate =
            serde_json::from_str(r#"{"op":"set","value":"CANARY7F3A"}"#).unwrap();
        assert_eq!(format!("{set:?}"), "Set([redacted])");
        let input = CustomFieldInput {
            id: None,
            label: "PIN".into(),
            field_type: CustomFieldType::Secret,
            value: None,
            secret: set,
        };
        assert!(!format!("{input:?}").contains("CANARY"));
        let unchanged: SecretUpdate = serde_json::from_str(r#"{"op":"unchanged"}"#).unwrap();
        assert_eq!(unchanged, SecretUpdate::Unchanged);
    }

    #[test]
    fn secret_refs_deserialize_from_tagged_json() {
        let r: SecretRef =
            serde_json::from_str(r#"{"kind":"backupCode","id":"m1","index":2}"#).unwrap();
        assert_eq!(
            r,
            SecretRef::BackupCode {
                id: "m1".into(),
                index: 2
            }
        );
    }
}
