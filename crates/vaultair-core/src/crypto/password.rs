//! Master password policy (ADR-0004 decision 4): at least 12 characters and a
//! zxcvbn score of 3 or more, no override. No maximum length. Enforced in
//! Rust; the UI only mirrors it.

use secrecy::SecretString;
use serde::Serialize;

use super::kdf::normalize;

pub const MIN_CHARS: usize = 12;
pub const MIN_SCORE: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PolicyError {
    #[error("the master password is shorter than {MIN_CHARS} characters")]
    TooShort,
    #[error("the master password is too easy to guess")]
    TooWeak,
}

/// zxcvbn score 0–4 (for display; computed in Rust).
pub fn strength(password: &SecretString) -> u8 {
    u8::from(zxcvbn::zxcvbn(&normalize(password), &[]).score())
}

/// Live feedback for the "create master password" form. Computed in Rust so
/// the UI and the enforced policy can't disagree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StrengthEstimate {
    /// zxcvbn score, 0 (trivial) to 4 (very strong).
    pub score: u8,
    pub long_enough: bool,
    pub meets_policy: bool,
    /// zxcvbn's fixed advice strings. They never echo the password.
    pub warning: Option<String>,
    pub suggestions: Vec<String>,
}

pub fn estimate(password: &SecretString) -> StrengthEstimate {
    let normalized = normalize(password);
    let entropy = zxcvbn::zxcvbn(&normalized, &[]);
    let score = u8::from(entropy.score());
    let long_enough = normalized.chars().count() >= MIN_CHARS;
    let feedback = entropy.feedback();
    StrengthEstimate {
        score,
        long_enough,
        meets_policy: long_enough && score >= MIN_SCORE,
        warning: feedback.and_then(|f| f.warning()).map(|w| w.to_string()),
        suggestions: feedback
            .map(|f| f.suggestions().iter().map(ToString::to_string).collect())
            .unwrap_or_default(),
    }
}

pub fn check_master_password(password: &SecretString) -> Result<(), PolicyError> {
    let normalized = normalize(password);
    if normalized.chars().count() < MIN_CHARS {
        return Err(PolicyError::TooShort);
    }
    if u8::from(zxcvbn::zxcvbn(&normalized, &[]).score()) < MIN_SCORE {
        return Err(PolicyError::TooWeak);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(s: &str) -> Result<(), PolicyError> {
        check_master_password(&SecretString::from(s))
    }

    #[test]
    fn policy() {
        assert_eq!(check("short"), Err(PolicyError::TooShort));
        assert_eq!(check("aaaaaaaaaaaaaaaa"), Err(PolicyError::TooWeak));
        assert_eq!(check("password12345"), Err(PolicyError::TooWeak));
        assert_eq!(check("orbit lantern cactus mosaic"), Ok(()));
    }

    #[test]
    fn estimate_matches_policy() {
        for pw in [
            "short",
            "aaaaaaaaaaaaaaaa",
            "password12345",
            "orbit lantern cactus mosaic",
        ] {
            let e = estimate(&SecretString::from(pw));
            assert_eq!(e.meets_policy, check(pw).is_ok(), "{pw}");
        }
        let weak = estimate(&SecretString::from("password12345"));
        assert!(weak.long_enough);
        assert!(weak.score < MIN_SCORE);
        assert!(weak.warning.is_some() || !weak.suggestions.is_empty());
    }

    #[test]
    fn estimate_never_echoes_the_password() {
        let pw = "Zqvx7Canary!Zqvx7Canary";
        let json = serde_json::to_string(&estimate(&SecretString::from(pw))).unwrap();
        assert!(!json.contains("Zqvx7"), "{json}");
    }

    #[test]
    fn length_counts_characters_not_bytes() {
        // 11 characters, 22+ bytes: still too short.
        assert_eq!(check("ééééééééééé"), Err(PolicyError::TooShort));
    }
}
