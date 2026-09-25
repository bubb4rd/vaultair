//! MFA methods, TOTP settings and backup-code parsing.

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::account::{text_enum, SecretUpdate};
use crate::AppError;

text_enum!(
    /// How an account's second factor works.
    MfaMethod {
        AuthenticatorApp => "authenticator_app",
        Totp => "totp",
        HardwareKey => "hardware_key",
        Sms => "sms",
        Email => "email",
        RecoveryCodesOnly => "recovery_codes_only",
        Unknown => "unknown",
    }
);

text_enum!(
    /// HMAC used for TOTP codes. Almost every service uses SHA-1.
    TotpAlgorithm {
        Sha1 => "SHA1",
        Sha256 => "SHA256",
        Sha512 => "SHA512",
    }
);

/// An MFA method as the form sends it. `id` is `None` for a new one.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MfaInput {
    pub id: Option<String>,
    pub method: MfaMethod,
    pub enabled: bool,
    /// A base32 setup key or an `otpauth://totp/...` link. Its settings
    /// (algorithm, digits, period) come from the link, or the defaults.
    #[serde(default)]
    pub totp_secret: SecretUpdate,
    #[serde(default)]
    pub recovery_instructions: SecretUpdate,
    pub notes: Option<String>,
}

/// One backup code. Only ever held decrypted in memory, wiped on drop.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct BackupCode {
    pub code: String,
    pub used: bool,
}

impl std::fmt::Debug for BackupCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BackupCode")
            .field("code", &"[redacted]")
            .field("used", &self.used)
            .finish()
    }
}

pub const MAX_BACKUP_CODES: usize = 100;
pub const MAX_BACKUP_CODE_CHARS: usize = 64;

/// Strips list numbering such as `1.`, `2)` or `3:` from the start of a line.
fn strip_numbering(line: &str) -> &str {
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && digits <= 3 {
        let rest = &line[digits..];
        if let Some(r) = rest.strip_prefix(['.', ')', ':']) {
            if r.starts_with(char::is_whitespace) {
                return r.trim_start();
            }
        }
    }
    line
}

/// Parses pasted backup codes: one per line, or separated by commas or
/// semicolons. List numbering is removed. A single line of equal-length
/// space-separated codes (`"a1b2c3 d4e5f6 g7h8i9"`) is split on spaces;
/// otherwise a space inside a code is kept (`"1234 5678"`). Duplicates are
/// dropped, order is kept.
pub fn parse_backup_codes(text: &str) -> Result<Vec<BackupCode>, AppError> {
    let invalid = AppError::InvalidInput {
        field: "backupCodes",
    };
    let mut pieces: Vec<&str> = text
        .split(['\n', '\r', ',', ';'])
        .map(|p| strip_numbering(p.trim()).trim())
        .filter(|p| !p.is_empty())
        .collect();
    if let [single] = pieces.as_slice() {
        let words: Vec<&str> = single.split_whitespace().collect();
        let first_len = words.first().map_or(0, |w| w.chars().count());
        if words.len() >= 3
            && first_len >= 6
            && words.iter().all(|w| w.chars().count() == first_len)
        {
            pieces = words;
        }
    }

    let mut codes: Vec<BackupCode> = Vec::new();
    for piece in pieces {
        let code: String = piece.split_whitespace().collect::<Vec<_>>().join(" ");
        if code.chars().count() > MAX_BACKUP_CODE_CHARS || code.chars().any(char::is_control) {
            return Err(invalid);
        }
        if !codes.iter().any(|c| c.code == code) {
            codes.push(BackupCode { code, used: false });
        }
    }
    if codes.is_empty() || codes.len() > MAX_BACKUP_CODES {
        return Err(invalid);
    }
    Ok(codes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(text: &str) -> Vec<String> {
        parse_backup_codes(text)
            .unwrap()
            .iter()
            .map(|c| c.code.clone())
            .collect()
    }

    #[test]
    fn one_code_per_line_with_numbering_removed() {
        assert_eq!(
            codes("1. abcd-1234\n2) efgh-5678\r\n\n3: ijkl-9012\n"),
            ["abcd-1234", "efgh-5678", "ijkl-9012"]
        );
    }

    #[test]
    fn commas_semicolons_and_a_single_spaced_line() {
        assert_eq!(
            codes("aaa111, bbb222; ccc333"),
            ["aaa111", "bbb222", "ccc333"]
        );
        assert_eq!(
            codes("a1b2c3d4 e5f6g7h8 i9j0k1l2 m3n4o5p6"),
            ["a1b2c3d4", "e5f6g7h8", "i9j0k1l2", "m3n4o5p6"]
        );
        // Google-style codes with an inner space stay whole.
        assert_eq!(codes("1234 5678\n8765 4321"), ["1234 5678", "8765 4321"]);
    }

    #[test]
    fn duplicates_dropped_and_limits_enforced() {
        assert_eq!(codes("x1y2z3\nx1y2z3\nq9"), ["x1y2z3", "q9"]);
        assert!(parse_backup_codes("  \n , ").is_err());
        assert!(parse_backup_codes(&"c".repeat(MAX_BACKUP_CODE_CHARS + 1)).is_err());
        let many: String = (0..=MAX_BACKUP_CODES)
            .map(|i| format!("code{i}\n"))
            .collect();
        assert!(parse_backup_codes(&many).is_err());
    }

    #[test]
    fn debug_hides_the_code() {
        let c = BackupCode {
            code: "CANARY7F3A".into(),
            used: true,
        };
        assert!(!format!("{c:?}").contains("CANARY"));
    }
}
