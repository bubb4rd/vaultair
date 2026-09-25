//! Field validation shared by accounts, MFA and (later) identities.
//!
//! Errors name the field (`AppError::InvalidInput { field }`), never the
//! value. Field names are the camelCase names the UI sends, so a form can
//! highlight the right control.

use crate::AppError;

pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_SHORT_CHARS: usize = 320;
pub const MAX_URL_CHARS: usize = 2048;
pub const MAX_NOTES_CHARS: usize = 20_000;
pub const MAX_SECRET_CHARS: usize = 4096;
pub const MAX_TAG_CHARS: usize = 40;
pub const MAX_TAGS: usize = 32;

fn invalid(field: &'static str) -> AppError {
    AppError::InvalidInput { field }
}

/// A required single-line value: trimmed, not empty, at most `max` characters.
pub fn required(value: &str, field: &'static str, max: usize) -> Result<String, AppError> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > max || v.chars().any(char::is_control) {
        return Err(invalid(field));
    }
    Ok(v.to_owned())
}

/// An optional single-line value: trimmed; empty becomes `None`.
pub fn optional(
    value: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(v) if v.chars().count() > max || v.chars().any(char::is_control) => {
            Err(invalid(field))
        }
        Some(v) => Ok(Some(v.to_owned())),
    }
}

/// Optional multi-line text (notes). Line breaks and tabs are allowed;
/// surrounding whitespace is trimmed.
pub fn optional_multiline(
    value: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(v)
            if v.chars().count() > max
                || v.chars()
                    .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) =>
        {
            Err(invalid(field))
        }
        Some(v) => Ok(Some(v.to_owned())),
    }
}

/// A loose email check: one `@`, something on both sides, a dot in the
/// domain, no whitespace. Deliverability isn't our business.
pub fn optional_email(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<String>, AppError> {
    let Some(v) = optional(value, field, MAX_SHORT_CHARS)? else {
        return Ok(None);
    };
    let ok = match v.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && !domain.contains('@')
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
                && !v.chars().any(char::is_whitespace)
        }
        None => false,
    };
    if ok {
        Ok(Some(v))
    } else {
        Err(invalid(field))
    }
}

/// Characters allowed in a stored URL: RFC 3986 unreserved, reserved and `%`.
/// No spaces, quotes, angle brackets, backslashes or anything non-ASCII, so a
/// stored URL can't smuggle arguments or odd parsing into the browser launch.
fn url_char_ok(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c)
}

/// Validates and normalizes a website or login URL.
///
/// Only `http://` and `https://` are accepted. A bare host such as
/// `example.com/login` gets `https://` added. Anything with another scheme
/// (`javascript:`, `file:`, `ms-settings:`, …) is rejected, as are
/// credentials in the authority (`https://bank.example@evil.example`), a
/// common way to disguise where a link goes.
pub fn web_url(value: &str, field: &'static str) -> Result<String, AppError> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > MAX_URL_CHARS || !v.chars().all(url_char_ok) {
        return Err(invalid(field));
    }
    // Every character is ASCII from here on, so byte slicing is safe.
    let lower = v.to_ascii_lowercase();
    let normalized = if lower.starts_with("https://") {
        format!("https://{}", &v[8..])
    } else if lower.starts_with("http://") {
        format!("http://{}", &v[7..])
    } else {
        // No scheme: a colon before the first slash means some other scheme.
        let head = v.split('/').next().unwrap_or("");
        if head.contains(':') || v.starts_with('/') {
            return Err(invalid(field));
        }
        format!("https://{v}")
    };
    host_of(&normalized).ok_or_else(|| invalid(field))?;
    Ok(normalized)
}

pub fn optional_web_url(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<String>, AppError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(v) => web_url(v, field).map(Some),
    }
}

/// The host of the part of a URL after `scheme://`, or `None` if the
/// authority carries credentials or is malformed. IPv6 literals aren't
/// supported; nobody logs in to a game at `[::1]`.
fn url_host(rest: &str) -> Option<&str> {
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return None;
    }
    let host = match authority.split_once(':') {
        Some((h, port)) => {
            if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            h
        }
        None => authority,
    };
    let valid = !host.is_empty()
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && !host.contains("..")
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'));
    valid.then_some(host)
}

/// The lowercased host of a URL (`https://` or `http://` only), or `None`.
/// Used by validation and by the "open login page" confirm.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    url_host(rest).map(str::to_ascii_lowercase)
}

/// Tags: trimmed, 1–40 characters, case-insensitively unique (the first
/// spelling wins), at most 32.
pub fn tags(values: &[String]) -> Result<Vec<String>, AppError> {
    let mut out: Vec<String> = Vec::new();
    for raw in values {
        let tag = raw.trim();
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > MAX_TAG_CHARS || tag.chars().any(char::is_control) {
            return Err(invalid("tags"));
        }
        if !out.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) {
            out.push(tag.to_owned());
        }
    }
    if out.len() > MAX_TAGS {
        return Err(invalid("tags"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
        r.err().and_then(|e| e.field())
    }

    #[test]
    fn urls_accept_http_and_https_only() {
        assert_eq!(
            web_url("https://example.com/login", "loginUrl").unwrap(),
            "https://example.com/login"
        );
        assert_eq!(
            web_url("HTTP://Example.com", "u").unwrap(),
            "http://Example.com"
        );
        assert_eq!(
            web_url("example.com/login?next=/", "u").unwrap(),
            "https://example.com/login?next=/"
        );
        assert_eq!(
            web_url("https://example.com:8443/x", "u").unwrap(),
            "https://example.com:8443/x"
        );
        for bad in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            "data:text/html,hi",
            "vbscript:msgbox",
            "ftp://example.com",
            "//example.com",
            "/relative/path",
            "https://",
            "https:///path",
            "https://bank.example@evil.example/",
            "https://exa mple.com",
            "https://example.com/\"onmouseover",
            "https://example.com\\@evil.example",
            "https://exämple.com",
            "https://example..com",
            "https://example.com:80a/",
            "https://example.com:/",
            "",
            "   ",
        ] {
            assert_eq!(
                field_of(web_url(bad, "loginUrl")),
                Some("loginUrl"),
                "{bad}"
            );
        }
    }

    #[test]
    fn host_is_extracted_for_the_confirm_dialog() {
        assert_eq!(
            host_of("https://Store.Example.com:443/login").as_deref(),
            Some("store.example.com")
        );
        assert_eq!(
            host_of("http://example.invalid").as_deref(),
            Some("example.invalid")
        );
        assert_eq!(host_of("javascript:alert(1)"), None);
    }

    #[test]
    fn required_and_optional_text() {
        assert_eq!(required("  Main  ", "title", 10).unwrap(), "Main");
        assert_eq!(field_of(required("   ", "title", 10)), Some("title"));
        assert_eq!(
            field_of(required("12345678901", "title", 10)),
            Some("title")
        );
        assert_eq!(field_of(required("a\u{0}b", "title", 10)), Some("title"));
        assert_eq!(optional(Some("  "), "x", 5).unwrap(), None);
        assert_eq!(optional(None, "x", 5).unwrap(), None);
        assert_eq!(
            optional_multiline(Some("line one\nline two\n"), "notes", 100).unwrap(),
            Some("line one\nline two".to_owned())
        );
    }

    #[test]
    fn emails_are_loosely_checked() {
        assert!(optional_email(Some("player@example.com"), "email").is_ok());
        assert_eq!(optional_email(Some(""), "email").unwrap(), None);
        for bad in [
            "player",
            "@example.com",
            "player@",
            "player@example",
            "a b@example.com",
            "a@b@example.com",
            "a@.com",
        ] {
            assert!(optional_email(Some(bad), "email").is_err(), "{bad}");
        }
    }

    #[test]
    fn tags_are_trimmed_and_deduplicated() {
        let t = tags(&["ranked".into(), " Ranked ".into(), "".into(), "EU".into()]).unwrap();
        assert_eq!(t, ["ranked", "EU"]);
        let many: Vec<String> = (0..=MAX_TAGS).map(|i| format!("t{i}")).collect();
        assert!(tags(&many).is_err());
        assert!(tags(&["x".repeat(MAX_TAG_CHARS + 1)]).is_err());
    }
}
