//! The key hierarchy.
//!
//! ```text
//! password --Argon2id--> KEK --unwraps--> DEK (random, 32 B)
//! DEK --HKDF-SHA256--> DB_KEY     (SQLCipher raw key)
//!                  --> FIELD_KEY  (field envelopes)
//!                  --> FP_KEY     (password fingerprints)
//!                  --> BACKUP_KEY (backup container MAC, Phase 14)
//!                  --> DEVICE_KEY (quick-unlock policy MAC, Phase 15b)
//! ```
//!
//! Changing the master password only re-wraps the DEK.

use std::fmt;

use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{ZeroizeOnDrop, Zeroizing};

use super::{rng, CryptoError, CryptoResult};

const INFO_DB: &[u8] = b"vaultair/v1/sqlcipher";
const INFO_FIELD: &[u8] = b"vaultair/v1/field";
const INFO_FP: &[u8] = b"vaultair/v1/pwfp";
const INFO_BACKUP: &[u8] = b"vaultair/v1/backup-mac";
const INFO_DEVICE_POLICY: &[u8] = b"vaultair/v1/quick-unlock-policy";

/// The data-encryption key. Generated once per vault.
#[derive(Clone, ZeroizeOnDrop)]
pub struct Dek([u8; 32]);

impl Dek {
    pub fn generate() -> CryptoResult<Self> {
        Ok(Self(*rng::secret_bytes::<32>()?))
    }

    pub(crate) fn from_bytes(bytes: &[u8]) -> CryptoResult<Self> {
        let arr: [u8; 32] = bytes.try_into().map_err(|_| CryptoError::Decrypt)?;
        Ok(Self(arr))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for Dek {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Dek([REDACTED])")
    }
}

/// All keys for an unlocked vault. Wiped on drop (i.e. on lock).
#[derive(ZeroizeOnDrop)]
pub struct VaultKeys {
    dek: Dek,
    db: [u8; 32],
    field: [u8; 32],
    fingerprint: [u8; 32],
    backup: [u8; 32],
    device_policy: [u8; 32],
}

fn expand(hk: &Hkdf<Sha256>, info: &[u8]) -> CryptoResult<[u8; 32]> {
    let mut out = [0u8; 32];
    hk.expand(info, &mut out).map_err(|_| CryptoError::Kdf)?;
    Ok(out)
}

impl VaultKeys {
    pub fn derive(dek: Dek) -> CryptoResult<Self> {
        let hk = Hkdf::<Sha256>::new(None, dek.as_bytes());
        Ok(Self {
            db: expand(&hk, INFO_DB)?,
            field: expand(&hk, INFO_FIELD)?,
            fingerprint: expand(&hk, INFO_FP)?,
            backup: expand(&hk, INFO_BACKUP)?,
            device_policy: expand(&hk, INFO_DEVICE_POLICY)?,
            dek,
        })
    }

    pub fn dek(&self) -> &Dek {
        &self.dek
    }

    pub fn field_key(&self) -> &[u8; 32] {
        &self.field
    }

    pub fn fingerprint_key(&self) -> &[u8; 32] {
        &self.fingerprint
    }

    pub fn backup_key(&self) -> &[u8; 32] {
        &self.backup
    }

    /// Keys the MAC on a device slot's policy record (`vault::device_slot`).
    pub fn device_policy_key(&self) -> &[u8; 32] {
        &self.device_policy
    }

    /// SQLCipher raw-key literal: `x'<64 hex chars>'`. Wiped on drop.
    pub(crate) fn sqlcipher_key_literal(&self) -> Zeroizing<String> {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        let mut s = Zeroizing::new(String::with_capacity(67));
        s.push_str("x'");
        for b in self.db {
            s.push(char::from(HEX[usize::from(b >> 4)]));
            s.push(char::from(HEX[usize::from(b & 0x0f)]));
        }
        s.push('\'');
        s
    }
}

impl fmt::Debug for VaultKeys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("VaultKeys([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subkeys_are_distinct_and_deterministic() {
        let dek = Dek::from_bytes(&[9u8; 32]).unwrap();
        let a = VaultKeys::derive(dek.clone()).unwrap();
        let b = VaultKeys::derive(dek).unwrap();
        let keys = [a.db, a.field, a.fingerprint, a.backup, a.device_policy];
        for (i, x) in keys.iter().enumerate() {
            for y in &keys[i + 1..] {
                assert_ne!(x, y);
            }
            assert_ne!(x, &[9u8; 32], "subkey must differ from the DEK");
        }
        assert_eq!(a.field, b.field);
    }

    #[test]
    fn debug_never_prints_key_material() {
        let keys = VaultKeys::derive(Dek::from_bytes(&[0xAB; 32]).unwrap()).unwrap();
        let dbg = format!("{keys:?} {:?}", keys.dek());
        assert_eq!(dbg, "VaultKeys([REDACTED]) Dek([REDACTED])");
        assert!(!dbg.contains("171") && !dbg.to_lowercase().contains("ab"));
    }

    #[test]
    fn sqlcipher_literal_shape() {
        let keys = VaultKeys::derive(Dek::from_bytes(&[1u8; 32]).unwrap()).unwrap();
        let lit = keys.sqlcipher_key_literal();
        assert_eq!(lit.len(), 67);
        assert!(lit.starts_with("x'") && lit.ends_with('\''));
        assert!(lit[2..66].bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
