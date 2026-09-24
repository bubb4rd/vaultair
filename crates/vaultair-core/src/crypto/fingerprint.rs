//! Keyed password fingerprints for reuse detection.
//!
//! `HMAC-SHA256(FP_KEY, NFC(password))`. Equal passwords in the same vault
//! have equal fingerprints, so reuse is a `GROUP BY` without decrypting
//! anything. The key is vault-specific, so fingerprints are useless outside
//! the vault. They never leave Rust.

use hmac::{Hmac, KeyInit, Mac};
use secrecy::SecretString;
use sha2::Sha256;

use super::kdf::normalize;

pub fn password_fingerprint(fp_key: &[u8; 32], password: &SecretString) -> [u8; 32] {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(fp_key).expect("HMAC accepts keys of any length");
    mac.update(normalize(password).as_bytes());
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_passwords_match_and_keys_separate_vaults() {
        let a = password_fingerprint(&[1; 32], &SecretString::from("Same-Password-1"));
        let b = password_fingerprint(&[1; 32], &SecretString::from("Same-Password-1"));
        let c = password_fingerprint(&[1; 32], &SecretString::from("Other-Password-1"));
        let d = password_fingerprint(&[2; 32], &SecretString::from("Same-Password-1"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, d);
    }
}
