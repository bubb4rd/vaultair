//! Spotting account details kept in an account's sensitive notes, so the UI
//! can suggest a proper field for them (ADR-0006).
//!
//! `scan` runs in Rust when the notes are saved, on plaintext the service
//! already holds to encrypt it. It returns flag bits only: never the text,
//! a position or a count, and nothing is logged. The bits are stored in
//! `account.sensitive_notes_hints` (inside the encrypted database) and
//! reach the UI as booleans. The app only suggests; it never moves data.

use serde::Serialize;

/// An email address, or a labelled username, login, gamertag or player ID.
pub const IDENTIFIERS: u8 = 1;
/// A labelled password, PIN or passcode.
pub const CREDENTIALS: u8 = 2;
/// Backup or recovery codes.
pub const BACKUP_CODES: u8 = 4;
/// A security question or its answer.
pub const SECURITY_ANSWERS: u8 = 8;
/// The user chose to keep things as they are. Cleared when the notes change.
pub const DISMISSED: u8 = 0x80;

/// Labels count only when followed by `:` or `=` ("Username: owl"), so
/// prose like "changed the password in May" doesn't trigger a suggestion.
const IDENTIFIER_LABELS: &[&str] = &[
    "username",
    "user name",
    "user id",
    "userid",
    "user",
    "login",
    "email",
    "e-mail",
    "gamertag",
    "player id",
    "account id",
    "account name",
];
const CREDENTIAL_LABELS: &[&str] = &["password", "passwd", "pwd", "pw", "pass", "pin", "passcode"];
/// Phrases distinctive enough to count anywhere.
const CODE_PHRASES: &[&str] = &[
    "backup code",
    "recovery code",
    "2fa code",
    "scratch code",
    "verification code",
];
const SECURITY_PHRASES: &[&str] = &[
    "security question",
    "security answer",
    "secret question",
    "secret answer",
    "maiden name",
];

/// What the account page suggests. All false once dismissed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NotesSuggestions {
    /// Move to Email, Username or Recovery email: visible, but trackable.
    pub identifiers: bool,
    /// Move to Password or a hidden custom field: still encrypted.
    pub credentials: bool,
    /// Move to the MFA section's backup codes: still encrypted, and counted.
    pub backup_codes: bool,
    /// Move to a hidden custom field: still encrypted, labelled on its own.
    pub security_answers: bool,
}

impl NotesSuggestions {
    pub fn from_bits(bits: u8) -> Self {
        if bits & DISMISSED != 0 {
            return Self::default();
        }
        Self {
            identifiers: bits & IDENTIFIERS != 0,
            credentials: bits & CREDENTIALS != 0,
            backup_codes: bits & BACKUP_CODES != 0,
            security_answers: bits & SECURITY_ANSWERS != 0,
        }
    }
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `label` as a whole word, followed (after spaces) by `:` or `=`.
fn has_label(lower: &str, label: &str) -> bool {
    lower.match_indices(label).any(|(i, _)| {
        let before_ok = lower[..i].chars().next_back().is_none_or(|c| !is_word(c));
        let rest = lower[i + label.len()..].trim_start_matches([' ', '\t']);
        before_ok && (rest.starts_with(':') || rest.starts_with('='))
    })
}

/// Something shaped like `local@domain.tld`.
fn has_email(text: &str) -> bool {
    text.split(|c: char| c.is_whitespace() || ",;()<>[]\"'".contains(c))
        .any(|token| {
            let token = token.trim_end_matches(['.', ':']);
            let Some((local, domain)) = token.split_once('@') else {
                return false;
            };
            !local.is_empty()
                && !domain.contains('@')
                && domain.rsplit_once('.').is_some_and(|(host, tld)| {
                    !host.is_empty() && tld.len() >= 2 && tld.chars().all(char::is_alphabetic)
                })
        })
}

/// The flag bits for a sensitive-notes text (never `DISMISSED`).
pub fn scan(text: &str) -> u8 {
    let lower = text.to_lowercase();
    let mut bits = 0;
    if has_email(text) || IDENTIFIER_LABELS.iter().any(|l| has_label(&lower, l)) {
        bits |= IDENTIFIERS;
    }
    if CREDENTIAL_LABELS.iter().any(|l| has_label(&lower, l)) {
        bits |= CREDENTIALS;
    }
    if CODE_PHRASES.iter().any(|p| lower.contains(p)) {
        bits |= BACKUP_CODES;
    }
    if SECURITY_PHRASES.iter().any(|p| lower.contains(p)) {
        bits |= SECURITY_ANSWERS;
    }
    bits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_emails_and_labelled_identifiers() {
        assert_eq!(scan("old login went to owl@example.com."), IDENTIFIERS);
        assert_eq!(scan("Username: nightowl"), IDENTIFIERS);
        assert_eq!(scan("gamertag = NightOwl#2231"), IDENTIFIERS);
        assert_eq!(scan("Player ID :  12345"), IDENTIFIERS);
    }

    #[test]
    fn finds_labelled_credentials_codes_and_security_answers() {
        assert_eq!(scan("PIN: 4821"), CREDENTIALS);
        assert_eq!(scan("pw=hunter2"), CREDENTIALS);
        assert_eq!(scan("Backup codes 1234-5678 2345-6789"), BACKUP_CODES);
        assert_eq!(scan("Security question: first pet"), SECURITY_ANSWERS);
        assert_eq!(
            scan("Email: a@example.com\nPassword: x\nRecovery codes below"),
            IDENTIFIERS | CREDENTIALS | BACKUP_CODES
        );
    }

    #[test]
    fn ignores_prose_and_lookalikes() {
        assert_eq!(
            scan("Changed the password in May; the login page moved."),
            0
        );
        assert_eq!(scan("Support said @nightowl on the forum"), 0);
        assert_eq!(scan("a@b"), 0);
        assert_eq!(scan("superuser: yes"), 0, "labels must start a word");
        assert_eq!(scan("passport: in the drawer"), 0);
        assert_eq!(scan(""), 0);
    }

    #[test]
    fn dismissed_hides_every_suggestion() {
        let all = IDENTIFIERS | CREDENTIALS | BACKUP_CODES | SECURITY_ANSWERS;
        assert!(NotesSuggestions::from_bits(all).identifiers);
        assert_eq!(
            NotesSuggestions::from_bits(all | DISMISSED),
            NotesSuggestions::default()
        );
    }
}
