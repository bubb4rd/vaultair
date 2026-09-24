//! Redaction helpers for anything that might reach logs.
//!
//! Masks are fixed-width (`****`), so a redacted value doesn't reveal its length.

use std::fmt;

const MASK: &str = "****";

/// Wraps a value so `Debug` and `Display` never print it.
///
/// Use it for fields that must never appear in logs or panic messages.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Redacted<T>(pub T);

impl<T> Redacted<T> {
    pub fn into_inner(self) -> T {
        self.0
    }
}

impl<T> fmt::Debug for Redacted<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl<T> fmt::Display for Redacted<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// Keeps the first and last character and masks the middle:
/// `"player"` → `"p****r"`. Values of three characters or fewer are fully masked.
fn mask_middle(s: &str) -> String {
    let mut chars = s.chars();
    match (chars.next(), chars.next_back()) {
        (Some(first), Some(last)) if s.chars().count() > 3 => format!("{first}{MASK}{last}"),
        _ => MASK.to_owned(),
    }
}

/// Redacts a username for logs: `"NightOwl"` → `"N****l"`.
pub fn redact_username(username: &str) -> String {
    mask_middle(username.trim())
}

/// Redacts an email for logs, keeping only the shape and the top-level domain:
/// `"player@example.com"` → `"p****r@e****e.com"`.
///
/// Anything that isn't `local@domain` is redacted like a username.
pub fn redact_email(email: &str) -> String {
    let email = email.trim();
    let Some((local, domain)) = email.rsplit_once('@') else {
        return redact_username(email);
    };
    if local.is_empty() || domain.is_empty() {
        return MASK.to_owned();
    }
    let domain = match domain.rsplit_once('.') {
        Some((name, tld)) if !name.is_empty() && !tld.is_empty() => {
            format!("{}.{tld}", mask_middle(name))
        }
        _ => mask_middle(domain),
    };
    format!("{}@{domain}", mask_middle(local))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_keeps_shape_and_tld_only() {
        assert_eq!(redact_email("player@example.com"), "p****r@e****e.com");
        assert_eq!(redact_email("  player@example.com "), "p****r@e****e.com");
    }

    #[test]
    fn email_mask_is_fixed_width() {
        assert_eq!(redact_email("abcd@wxyz.io"), "a****d@w****z.io");
        assert_eq!(
            redact_email("averyveryverylongname@longdomainname.co"),
            "a****e@l****e.co"
        );
    }

    #[test]
    fn subdomains_are_masked_together() {
        assert_eq!(redact_email("gamer@mail.example.net"), "g****r@m****e.net");
    }

    #[test]
    fn short_parts_are_fully_masked() {
        assert_eq!(redact_email("ab@x.com"), "****@****.com");
        assert_eq!(redact_email("abc@xyz.gg"), "****@****.gg");
    }

    #[test]
    fn malformed_emails_never_echo_input() {
        for input in [
            "@example.com",
            "player@",
            "@",
            "",
            "no-at-sign",
            "player@.com",
            "p@com.",
        ] {
            let out = redact_email(input);
            assert!(!out.contains("example"), "{input:?} -> {out:?}");
            assert!(!out.contains("player"), "{input:?} -> {out:?}");
            assert!(!out.contains("no-at"), "{input:?} -> {out:?}");
        }
    }

    #[test]
    fn username_redaction() {
        assert_eq!(redact_username("NightOwl"), "N****l");
        assert_eq!(redact_username("abc"), "****");
        assert_eq!(redact_username(""), "****");
    }

    #[test]
    fn username_redaction_handles_non_ascii() {
        assert_eq!(redact_username("ÆvarÞór"), "Æ****r");
        assert_eq!(redact_username("玩家一号"), "玩****号");
    }

    #[test]
    fn redacted_wrapper_hides_value_in_debug_and_display() {
        let r = Redacted("CANARY7F3A");
        assert_eq!(format!("{r:?}"), "[redacted]");
        assert_eq!(format!("{r}"), "[redacted]");
        assert_eq!(format!("{:?}", Some(r)), "Some([redacted])");
        assert_eq!(r.into_inner(), "CANARY7F3A");
    }
}
