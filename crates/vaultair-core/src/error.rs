//! The error type that crosses into the UI.
//!
//! `AppError` never carries dynamic data: no user input, file paths, SQL text
//! or library error messages. It serializes to `{ code, message }` where the
//! message is fixed per code. Callers log the underlying cause themselves,
//! through redaction, before converting to `AppError`.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Stable, machine-readable error codes. The frontend switches on these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    VaultLocked,
    InvalidInput,
    NotFound,
    Internal,
    WrongPassword,
    WeakPassword,
    VaultNotFound,
    VaultExists,
    VaultInUse,
    VaultTooNew,
    VaultCorrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AppError {
    /// A data command was called while the vault is locked.
    #[error("the vault is locked")]
    VaultLocked,
    /// Input failed validation. `field` is a static field name, never the value.
    #[error("invalid input for field `{field}`")]
    InvalidInput { field: &'static str },
    #[error("not found")]
    NotFound,
    /// Anything unexpected. `context` is a static description of where it happened.
    #[error("internal error ({context})")]
    Internal { context: &'static str },
    /// Wrong master password, or a tampered header (indistinguishable on purpose).
    #[error("wrong master password")]
    WrongPassword,
    #[error("master password does not meet the policy")]
    WeakPassword,
    #[error("vault not found")]
    VaultNotFound,
    #[error("a vault already exists there")]
    VaultExists,
    #[error("vault is open elsewhere")]
    VaultInUse,
    #[error("vault needs a newer version")]
    VaultTooNew,
    #[error("vault is damaged")]
    VaultCorrupted,
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::VaultLocked => ErrorCode::VaultLocked,
            Self::InvalidInput { .. } => ErrorCode::InvalidInput,
            Self::NotFound => ErrorCode::NotFound,
            Self::Internal { .. } => ErrorCode::Internal,
            Self::WrongPassword => ErrorCode::WrongPassword,
            Self::WeakPassword => ErrorCode::WeakPassword,
            Self::VaultNotFound => ErrorCode::VaultNotFound,
            Self::VaultExists => ErrorCode::VaultExists,
            Self::VaultInUse => ErrorCode::VaultInUse,
            Self::VaultTooNew => ErrorCode::VaultTooNew,
            Self::VaultCorrupted => ErrorCode::VaultCorrupted,
        }
    }

    /// User-safe message shown in the UI. Fixed per code.
    pub fn user_message(&self) -> &'static str {
        match self {
            Self::VaultLocked => "The vault is locked.",
            Self::InvalidInput { .. } => "Some of the details entered aren't valid.",
            Self::NotFound => "That item no longer exists.",
            Self::Internal { .. } => "Something went wrong. Your vault was not changed.",
            Self::WrongPassword => "Incorrect master password.",
            Self::WeakPassword => "Choose a longer or less predictable master password.",
            Self::VaultNotFound => "No vault was found at that location.",
            Self::VaultExists => {
                "That folder already contains files. Choose another name or location."
            }
            Self::VaultInUse => "This vault is already open in another Vaultair window.",
            Self::VaultTooNew => {
                "This vault was made by a newer version of Vaultair. Update to open it."
            }
            Self::VaultCorrupted => "This vault appears to be damaged. Restore it from a backup.",
        }
    }

    /// Static field name for `InvalidInput`, so forms can highlight it.
    pub fn field(&self) -> Option<&'static str> {
        match self {
            Self::InvalidInput { field } => Some(field),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let field = self.field();
        let mut s = serializer.serialize_struct("AppError", if field.is_some() { 3 } else { 2 })?;
        s.serialize_field("code", &self.code())?;
        s.serialize_field("message", self.user_message())?;
        if let Some(field) = field {
            s.serialize_field("field", field)?;
        }
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_code_and_fixed_message_only() {
        let json = serde_json::to_value(AppError::Internal { context: "db open" }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "code": "internal",
                "message": "Something went wrong. Your vault was not changed."
            })
        );
        // The internal context is for logs, not the UI.
        assert!(!json.to_string().contains("db open"));
    }

    #[test]
    fn invalid_input_exposes_field_name_only() {
        let json = serde_json::to_value(AppError::InvalidInput { field: "email" }).unwrap();
        assert_eq!(json["code"], "invalid_input");
        assert_eq!(json["field"], "email");
        assert_eq!(json.as_object().unwrap().len(), 3);
    }

    #[test]
    fn every_variant_serializes_without_extra_keys() {
        for err in [
            AppError::VaultLocked,
            AppError::NotFound,
            AppError::Internal { context: "x" },
            AppError::WrongPassword,
            AppError::WeakPassword,
            AppError::VaultNotFound,
            AppError::VaultExists,
            AppError::VaultInUse,
            AppError::VaultTooNew,
            AppError::VaultCorrupted,
        ] {
            let json = serde_json::to_value(&err).unwrap();
            let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
            assert_eq!(keys, ["code", "message"], "{err:?}");
        }
    }
}
