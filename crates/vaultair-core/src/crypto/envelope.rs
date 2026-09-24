//! Field envelopes: a second encryption layer for the most sensitive columns
//! (passwords, TOTP secrets, backup codes, recovery instructions, sensitive
//! notes, secret custom fields). They stay ciphertext inside the unlocked
//! database until an explicit reveal or copy.
//!
//! Layout: `[version u8 = 0x01][nonce 24 B][ciphertext || tag 16 B]`
//! AAD: `"vaultair|v1|" + table + "|" + column + "|" + row_id`, which binds a
//! ciphertext to its exact cell so it can't be moved to another row/column.

use zeroize::Zeroizing;

use super::aead::{self, NONCE_LEN, TAG_LEN};
use super::{CryptoError, CryptoResult};

pub const VERSION: u8 = 0x01;
const HEADER_LEN: usize = 1 + NONCE_LEN;

/// Identifies the cell an envelope belongs to.
#[derive(Debug, Clone, Copy)]
pub struct FieldRef<'a> {
    pub table: &'a str,
    pub column: &'a str,
    pub row_id: &'a str,
}

impl FieldRef<'_> {
    fn aad(&self) -> Vec<u8> {
        format!("vaultair|v1|{}|{}|{}", self.table, self.column, self.row_id).into_bytes()
    }
}

pub fn seal(field_key: &[u8; 32], cell: FieldRef<'_>, plaintext: &[u8]) -> CryptoResult<Vec<u8>> {
    let (nonce, ct) = aead::seal(field_key, &cell.aad(), plaintext)?;
    let mut out = Vec::with_capacity(HEADER_LEN + ct.len());
    out.push(VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn open(
    field_key: &[u8; 32],
    cell: FieldRef<'_>,
    blob: &[u8],
) -> CryptoResult<Zeroizing<Vec<u8>>> {
    if blob.len() < HEADER_LEN + TAG_LEN || blob[0] != VERSION {
        return Err(CryptoError::MalformedEnvelope);
    }
    let nonce: [u8; NONCE_LEN] = blob[1..HEADER_LEN]
        .try_into()
        .map_err(|_| CryptoError::MalformedEnvelope)?;
    aead::open(field_key, &nonce, &cell.aad(), &blob[HEADER_LEN..])
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [5u8; 32];

    fn cell<'a>(column: &'a str, row: &'a str) -> FieldRef<'a> {
        FieldRef {
            table: "account",
            column,
            row_id: row,
        }
    }

    #[test]
    fn round_trip() {
        let blob = seal(&KEY, cell("password_enc", "r1"), b"hunter2-CANARY").unwrap();
        assert_eq!(blob[0], VERSION);
        let pt = open(&KEY, cell("password_enc", "r1"), &blob).unwrap();
        assert_eq!(pt.as_slice(), b"hunter2-CANARY");
    }

    #[test]
    fn ciphertext_is_bound_to_its_cell() {
        let blob = seal(&KEY, cell("password_enc", "r1"), b"secret").unwrap();
        assert_eq!(
            open(&KEY, cell("password_enc", "r2"), &blob).err(),
            Some(CryptoError::Decrypt)
        );
        assert_eq!(
            open(&KEY, cell("sensitive_notes_enc", "r1"), &blob).err(),
            Some(CryptoError::Decrypt)
        );
        let other_table = FieldRef {
            table: "mfa_method",
            column: "password_enc",
            row_id: "r1",
        };
        assert_eq!(
            open(&KEY, other_table, &blob).err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn version_byte_and_length_are_checked() {
        let mut blob = seal(&KEY, cell("password_enc", "r1"), b"secret").unwrap();
        blob[0] = 0x02;
        assert_eq!(
            open(&KEY, cell("password_enc", "r1"), &blob).err(),
            Some(CryptoError::MalformedEnvelope)
        );
        assert_eq!(
            open(&KEY, cell("password_enc", "r1"), &[VERSION; 10]).err(),
            Some(CryptoError::MalformedEnvelope)
        );
        assert_eq!(
            open(&KEY, cell("password_enc", "r1"), &[]).err(),
            Some(CryptoError::MalformedEnvelope)
        );
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        let blob = seal(&KEY, cell("password_enc", "r1"), b"CANARY7F3A").unwrap();
        assert!(!blob.windows(10).any(|w| w == b"CANARY7F3A"));
    }
}
