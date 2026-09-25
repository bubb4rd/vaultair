//! TOTP codes (RFC 6238) for "Copy TOTP code" (ADR-0004 decision 2).
//!
//! Built on the RustCrypto HMAC and SHA crates the vault already uses rather
//! than a TOTP crate, which would pull in older duplicates of them. Setup
//! keys are accepted as base32 or as an `otpauth://totp/` link, and stored
//! (as a field envelope) in canonical base32 so a reveal shows what the
//! service originally displayed.

use hmac::{Hmac, KeyInit, Mac};
use zeroize::Zeroizing;

use crate::domain::mfa::TotpAlgorithm;
use crate::AppError;

pub const DEFAULT_DIGITS: u8 = 6;
pub const DEFAULT_PERIOD: u32 = 30;
/// 80 bits: shorter than RFC 4226 recommends, but real services use it.
const MIN_SECRET_BYTES: usize = 10;
const MAX_SECRET_BYTES: usize = 128;

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// A parsed setup key and its settings.
pub struct TotpSetup {
    /// Canonical base32 (upper case, no spaces or padding). What gets stored.
    pub base32: Zeroizing<String>,
    pub algorithm: TotpAlgorithm,
    pub digits: u8,
    pub period: u32,
}

impl std::fmt::Debug for TotpSetup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TotpSetup")
            .field("algorithm", &self.algorithm)
            .field("digits", &self.digits)
            .field("period", &self.period)
            .finish_non_exhaustive()
    }
}

fn invalid() -> AppError {
    AppError::InvalidInput {
        field: "totpSecret",
    }
}

/// Decodes RFC 4648 base32, ignoring spaces, hyphens, padding and case.
pub fn base32_decode(input: &str) -> Option<Zeroizing<Vec<u8>>> {
    let mut out = Zeroizing::new(Vec::with_capacity(input.len() * 5 / 8));
    let mut buffer: u64 = 0;
    let mut bits = 0u32;
    for c in input.chars() {
        if matches!(c, ' ' | '-' | '=' | '\t') {
            continue;
        }
        let upper = c.to_ascii_uppercase();
        let value = BASE32.iter().position(|&b| char::from(b) == upper)?;
        // Only the low `bits` bits are pending; masking keeps the shift from overflowing.
        buffer = ((buffer << 5) | value as u64) & 0xffff;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

pub fn base32_encode(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity(bytes.len().div_ceil(5) * 8));
    let mut buffer: u64 = 0;
    let mut bits = 0u32;
    for &b in bytes {
        buffer = ((buffer << 8) | u64::from(b)) & 0xffff;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(char::from(BASE32[((buffer >> bits) & 31) as usize]));
        }
    }
    if bits > 0 {
        out.push(char::from(BASE32[((buffer << (5 - bits)) & 31) as usize]));
    }
    out
}

/// Minimal `%XX` decoding for otpauth query values.
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = s.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Parses a base32 setup key or an `otpauth://totp/...` link.
pub fn parse_setup(input: &str) -> Result<TotpSetup, AppError> {
    let input = input.trim();
    let mut algorithm = TotpAlgorithm::Sha1;
    let mut digits = DEFAULT_DIGITS;
    let mut period = DEFAULT_PERIOD;

    let is_totp_link = input.len() > 15
        && input
            .get(..15)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("otpauth://totp/"));
    let secret_text: Zeroizing<String> = if is_totp_link {
        let query = input.split_once('?').map(|(_, q)| q).ok_or_else(invalid)?;
        let mut secret = None;
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            let value = percent_decode(value).ok_or_else(invalid)?;
            match key.to_ascii_lowercase().as_str() {
                "secret" => secret = Some(Zeroizing::new(value)),
                "algorithm" => {
                    algorithm =
                        TotpAlgorithm::parse(&value.to_ascii_uppercase()).ok_or_else(invalid)?;
                }
                "digits" => digits = value.parse().map_err(|_| invalid())?,
                "period" => period = value.parse().map_err(|_| invalid())?,
                _ => {}
            }
        }
        secret.ok_or_else(invalid)?
    } else if input.contains("://") {
        // otpauth://hotp and anything else: counter-based codes aren't supported.
        return Err(invalid());
    } else {
        Zeroizing::new(input.to_owned())
    };

    if !(6..=8).contains(&digits) || !(10..=300).contains(&period) {
        return Err(invalid());
    }
    let bytes = base32_decode(&secret_text).ok_or_else(invalid)?;
    if !(MIN_SECRET_BYTES..=MAX_SECRET_BYTES).contains(&bytes.len()) {
        return Err(invalid());
    }
    Ok(TotpSetup {
        base32: base32_encode(&bytes),
        algorithm,
        digits,
        period,
    })
}

/// HMAC of `msg` under `key` with digest `$d`, as a byte vector.
macro_rules! hmac {
    ($d:ty, $key:expr, $msg:expr) => {{
        let mut mac =
            <Hmac<$d> as KeyInit>::new_from_slice($key).expect("HMAC accepts keys of any length");
        mac.update($msg);
        mac.finalize().into_bytes().to_vec()
    }};
}

/// The code for `unix_time` (seconds). `digits` is 6–8.
pub fn code(
    secret: &[u8],
    algorithm: TotpAlgorithm,
    digits: u8,
    period: u32,
    unix_time: i64,
) -> Zeroizing<String> {
    let counter = u64::try_from(unix_time.max(0)).unwrap_or(0) / u64::from(period.max(1));
    let msg = counter.to_be_bytes();
    let digest = Zeroizing::new(match algorithm {
        TotpAlgorithm::Sha1 => hmac!(sha1::Sha1, secret, &msg),
        TotpAlgorithm::Sha256 => hmac!(sha2::Sha256, secret, &msg),
        TotpAlgorithm::Sha512 => hmac!(sha2::Sha512, secret, &msg),
    });
    let offset = usize::from(digest[digest.len() - 1] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    let value = binary % 10u32.pow(u32::from(digits));
    Zeroizing::new(format!("{value:0width$}", width = usize::from(digits)))
}

/// Seconds until the code for `unix_time` changes.
pub fn seconds_remaining(period: u32, unix_time: i64) -> u32 {
    let period = i64::from(period.max(1));
    u32::try_from(period - unix_time.rem_euclid(period)).unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 appendix B test vectors (8 digits).
    #[test]
    fn rfc6238_vectors() {
        let sha1 = b"12345678901234567890";
        let sha256 = b"12345678901234567890123456789012";
        let sha512 = b"1234567890123456789012345678901234567890123456789012345678901234";
        let cases: [(i64, &str, &str, &str); 6] = [
            (59, "94287082", "46119246", "90693936"),
            (1_111_111_109, "07081804", "68084774", "25091201"),
            (1_111_111_111, "14050471", "67062674", "99943326"),
            (1_234_567_890, "89005924", "91819424", "93441116"),
            (2_000_000_000, "69279037", "90698825", "38618901"),
            (20_000_000_000, "65353130", "77737706", "47863826"),
        ];
        for (t, c1, c256, c512) in cases {
            assert_eq!(
                code(sha1, TotpAlgorithm::Sha1, 8, 30, t).as_str(),
                c1,
                "{t}"
            );
            assert_eq!(
                code(sha256, TotpAlgorithm::Sha256, 8, 30, t).as_str(),
                c256,
                "{t}"
            );
            assert_eq!(
                code(sha512, TotpAlgorithm::Sha512, 8, 30, t).as_str(),
                c512,
                "{t}"
            );
        }
    }

    #[test]
    fn six_digit_codes_keep_leading_zeros() {
        // "07081804" at 8 digits is 081804 at 6.
        assert_eq!(
            code(
                b"12345678901234567890",
                TotpAlgorithm::Sha1,
                6,
                30,
                1_111_111_109
            )
            .as_str(),
            "081804"
        );
    }

    #[test]
    fn base32_round_trip_and_leniency() {
        let key = parse_setup("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").unwrap();
        assert_eq!(key.base32.as_str(), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(
            base32_decode(&key.base32).unwrap().as_slice(),
            b"12345678901234567890"
        );
        assert_eq!(
            (key.digits, key.period, key.algorithm),
            (6, 30, TotpAlgorithm::Sha1)
        );
        assert!(parse_setup("not base32 !!").is_err());
        assert!(parse_setup("GEZDGNBV").is_err(), "too short");
        assert!(parse_setup("").is_err());
        // Multi-byte text across byte 15 must be an error, not a slicing panic.
        assert!(parse_setup("otpauth://totpé/x?secret=GEZDGNBVGY3TQOJQ").is_err());
        assert!(parse_setup("ключ-настройки-длинный").is_err());
    }

    #[test]
    fn otpauth_links_carry_their_settings() {
        let key = parse_setup(
            "otpauth://totp/Example%3Aplayer%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&algorithm=SHA256&digits=8&period=60",
        )
        .unwrap();
        assert_eq!(
            (key.digits, key.period, key.algorithm),
            (8, 60, TotpAlgorithm::Sha256)
        );
        assert!(parse_setup("otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ&counter=1").is_err());
        assert!(parse_setup("otpauth://totp/x?issuer=Example").is_err());
        assert!(parse_setup("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZD&digits=12").is_err());
    }

    #[test]
    fn seconds_remaining_counts_down() {
        assert_eq!(seconds_remaining(30, 0), 30);
        assert_eq!(seconds_remaining(30, 29), 1);
        assert_eq!(seconds_remaining(30, 30), 30);
    }
}
