//! Master password policy (ADR-0004 decision 4): at least 12 characters and a
//! zxcvbn score of 3 or more, no override. No maximum length. Enforced in
//! Rust; the UI only mirrors it.

use secrecy::SecretString;

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
    fn length_counts_characters_not_bytes() {
        // 11 characters, 22+ bytes: still too short.
        assert_eq!(check("ééééééééééé"), Err(PolicyError::TooShort));
    }
}
