//! The vault header (`vault.vhdr`): everything needed before the database can
//! be opened. It holds no user data. See `docs/vault-format.md`.
//!
//! ```text
//! "VAULTAIR" (8) | format_version u16 LE | body_len u32 LE | JSON body | CRC32 u32 LE
//! ```
//!
//! The CRC only catches accidental damage. Tampering is caught by the key
//! wrap: its AAD is the canonical JSON of every field except the slot's own
//! nonce and ciphertext, so changing any KDF parameter, the salt, the vault
//! id or anything else makes the unwrap fail.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::error::{CorruptPart, VaultError};
use crate::crypto::aead::{NONCE_LEN, TAG_LEN};
use crate::crypto::kdf::{KdfParams, KEY_LEN, SALT_LEN};

pub const MAGIC: &[u8; 8] = b"VAULTAIR";
/// The format this build writes.
pub const FORMAT_VERSION: u16 = 1;
/// The newest format this build can read.
pub const READER_VERSION: u16 = 1;
const PREFIX_LEN: usize = 8 + 2 + 4;
const CRC_LEN: usize = 4;
/// Upper bound on the JSON body; real headers are about 1 KB.
const MAX_BODY_LEN: usize = 64 * 1024;
const AAD_DOMAIN: &[u8] = b"vaultair-header-aad-v1\0";

pub const KDF_ALG: &str = "argon2id";
pub const KDF_VERSION: u32 = 19;
pub const WRAP_ALG: &str = "xchacha20poly1305";
pub const SLOT_PASSWORD: &str = "password";
pub const NORMALIZATION: &str = "NFC";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultHeader {
    pub vault_id: String,
    pub created_at: String,
    pub format_version: u16,
    pub min_reader_version: u16,
    pub demo: bool,
    pub kdf: KdfSection,
    pub pw_normalization: String,
    pub key_slots: Vec<KeySlot>,
    pub db: DbSection,
    pub field_envelope_version: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KdfSection {
    pub alg: String,
    pub v: u32,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    pub salt_b64: String,
    pub out_len: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeySlot {
    pub kind: String,
    pub kdf_ref: String,
    pub wrap: Wrap,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wrap {
    pub alg: String,
    pub nonce_b64: String,
    pub ct_b64: String,
}

/// SQLCipher settings, pinned so a library upgrade can't silently change them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DbSection {
    pub engine: String,
    pub compat: u32,
    pub page_size: u32,
    pub hmac: String,
    pub kdf: String,
    pub plaintext_header_size: u32,
}

impl DbSection {
    pub fn pinned() -> Self {
        Self {
            engine: "sqlcipher".into(),
            compat: 4,
            page_size: 4096,
            hmac: "HMAC_SHA512".into(),
            kdf: "PBKDF2_HMAC_SHA512".into(),
            plaintext_header_size: 0,
        }
    }
}

fn corrupt() -> VaultError {
    VaultError::Corrupted(CorruptPart::Header)
}

/// The parts of a validated password slot, decoded.
#[derive(Debug)]
pub struct PasswordSlot {
    pub params: KdfParams,
    pub salt: [u8; SALT_LEN],
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

impl VaultHeader {
    /// A header for a new vault. The slot's wrap is filled in by `set_wrap`.
    pub fn new(
        vault_id: String,
        created_at: String,
        params: KdfParams,
        salt: &[u8; SALT_LEN],
        demo: bool,
    ) -> Self {
        Self {
            vault_id,
            created_at,
            format_version: FORMAT_VERSION,
            min_reader_version: FORMAT_VERSION,
            demo,
            kdf: KdfSection {
                alg: KDF_ALG.into(),
                v: KDF_VERSION,
                m_kib: params.m_kib,
                t: params.t,
                p: params.p,
                salt_b64: B64.encode(salt),
                out_len: 32,
            },
            pw_normalization: NORMALIZATION.into(),
            key_slots: vec![KeySlot {
                kind: SLOT_PASSWORD.into(),
                kdf_ref: "kdf".into(),
                wrap: Wrap {
                    alg: WRAP_ALG.into(),
                    nonce_b64: String::new(),
                    ct_b64: String::new(),
                },
            }],
            db: DbSection::pinned(),
            field_envelope_version: 1,
        }
    }

    pub fn kdf_params(&self) -> KdfParams {
        KdfParams {
            m_kib: self.kdf.m_kib,
            t: self.kdf.t,
            p: self.kdf.p,
        }
    }

    /// Additional authenticated data for the key wrap: every field except the
    /// wrap nonces and ciphertexts, as canonical JSON (struct field order is fixed).
    pub fn aad(&self) -> Vec<u8> {
        let mut unwrapped = self.clone();
        for slot in &mut unwrapped.key_slots {
            slot.wrap.nonce_b64.clear();
            slot.wrap.ct_b64.clear();
        }
        let mut out = AAD_DOMAIN.to_vec();
        // Serializing plain structs of strings and integers can't fail.
        out.extend(serde_json::to_vec(&unwrapped).unwrap_or_default());
        out
    }

    /// The same vault with new KDF parameters and salt, and an empty wrap for
    /// `set_wrap` to fill. Used when the master password or KDF changes.
    pub fn with_kdf(&self, params: KdfParams, salt: &[u8; SALT_LEN]) -> Self {
        let mut next = self.clone();
        next.kdf.m_kib = params.m_kib;
        next.kdf.t = params.t;
        next.kdf.p = params.p;
        next.kdf.salt_b64 = B64.encode(salt);
        next.set_wrap(&[0; NONCE_LEN], &[]);
        next
    }

    pub fn set_wrap(&mut self, nonce: &[u8; NONCE_LEN], ciphertext: &[u8]) {
        if let Some(slot) = self.key_slots.first_mut() {
            slot.wrap.nonce_b64 = B64.encode(nonce);
            slot.wrap.ct_b64 = B64.encode(ciphertext);
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let body = serde_json::to_vec(self).unwrap_or_default();
        let mut out = Vec::with_capacity(PREFIX_LEN + body.len() + CRC_LEN);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&self.format_version.to_le_bytes());
        // Bodies are ~1 KB; MAX_BODY_LEN keeps this well inside u32.
        #[allow(clippy::cast_possible_truncation)]
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        let crc = crc32fast::hash(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        out
    }

    /// Parses and structurally validates a header. Does not check KDF bounds
    /// (see `password_slot`) and cannot detect tampering (the unwrap does).
    pub fn decode(bytes: &[u8]) -> Result<Self, VaultError> {
        if bytes.len() < PREFIX_LEN + CRC_LEN || &bytes[..8] != MAGIC {
            return Err(corrupt());
        }
        let version = u16::from_le_bytes([bytes[8], bytes[9]]);
        if version > READER_VERSION {
            return Err(VaultError::TooNew);
        }
        let body_len = u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize;
        if body_len > MAX_BODY_LEN || bytes.len() != PREFIX_LEN + body_len + CRC_LEN {
            return Err(corrupt());
        }
        let (content, crc_bytes) = bytes.split_at(PREFIX_LEN + body_len);
        let stored_crc =
            u32::from_le_bytes([crc_bytes[0], crc_bytes[1], crc_bytes[2], crc_bytes[3]]);
        if crc32fast::hash(content) != stored_crc {
            return Err(corrupt());
        }
        let header: Self = serde_json::from_slice(&content[PREFIX_LEN..]).map_err(|_| corrupt())?;
        if header.min_reader_version > READER_VERSION {
            return Err(VaultError::TooNew);
        }
        if header.format_version != version {
            return Err(corrupt());
        }
        header.validate_structure()?;
        Ok(header)
    }

    fn validate_structure(&self) -> Result<(), VaultError> {
        let ok = self.kdf.alg == KDF_ALG
            && self.kdf.v == KDF_VERSION
            && self.kdf.out_len as usize == KEY_LEN
            && self.pw_normalization == NORMALIZATION
            && self.key_slots.len() == 1
            && self.key_slots[0].kind == SLOT_PASSWORD
            && self.key_slots[0].kdf_ref == "kdf"
            && self.key_slots[0].wrap.alg == WRAP_ALG
            && self.db == DbSection::pinned()
            && self.field_envelope_version == 1
            && uuid::Uuid::parse_str(&self.vault_id).is_ok();
        if ok {
            Ok(())
        } else {
            Err(corrupt())
        }
    }

    /// Decodes the password slot and enforces KDF floors and caps, so a
    /// tampered header can't make us run a weak (or enormous) Argon2.
    pub fn password_slot(&self) -> Result<PasswordSlot, VaultError> {
        let params = self.kdf_params();
        params.validate().map_err(|_| corrupt())?;
        let salt: [u8; SALT_LEN] = decode_fixed(&self.kdf.salt_b64)?;
        let slot = self.key_slots.first().ok_or_else(corrupt)?;
        let nonce: [u8; NONCE_LEN] = decode_fixed(&slot.wrap.nonce_b64)?;
        let ciphertext = B64.decode(&slot.wrap.ct_b64).map_err(|_| corrupt())?;
        if ciphertext.len() != KEY_LEN + TAG_LEN {
            return Err(corrupt());
        }
        Ok(PasswordSlot {
            params,
            salt,
            nonce,
            ciphertext,
        })
    }
}

fn decode_fixed<const N: usize>(b64: &str) -> Result<[u8; N], VaultError> {
    B64.decode(b64)
        .ok()
        .and_then(|v| <[u8; N]>::try_from(v.as_slice()).ok())
        .ok_or_else(corrupt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> VaultHeader {
        let mut h = VaultHeader::new(
            uuid::Uuid::now_v7().to_string(),
            "2026-09-23T00:00:00Z".into(),
            KdfParams::MINIMUM,
            &[7; SALT_LEN],
            false,
        );
        h.set_wrap(&[1; NONCE_LEN], &[2; KEY_LEN + TAG_LEN]);
        h
    }

    #[test]
    fn encode_decode_round_trip() {
        let h = sample();
        let bytes = h.encode();
        assert_eq!(&bytes[..8], MAGIC);
        assert_eq!(VaultHeader::decode(&bytes).unwrap(), h);
        let slot = h.password_slot().unwrap();
        assert_eq!(slot.params, KdfParams::MINIMUM);
        assert_eq!(slot.salt, [7; SALT_LEN]);
    }

    #[test]
    fn structural_damage_is_corruption() {
        let bytes = sample().encode();
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("truncated", bytes[..bytes.len() - 1].to_vec()),
            ("bad magic", [b"VAULTAIX".as_slice(), &bytes[8..]].concat()),
            ("bad crc", {
                let mut b = bytes.clone();
                let n = b.len() - 1;
                b[n] ^= 0xff;
                b
            }),
            ("flipped body byte", {
                let mut b = bytes.clone();
                b[PREFIX_LEN + 5] ^= 0x01;
                b
            }),
            ("extra trailing byte", [bytes.as_slice(), &[0]].concat()),
        ];
        for (name, case) in cases {
            assert_eq!(
                VaultHeader::decode(&case),
                Err(VaultError::Corrupted(CorruptPart::Header)),
                "{name}"
            );
        }
    }

    #[test]
    fn newer_formats_are_too_new() {
        let mut h = sample();
        h.format_version = FORMAT_VERSION + 1;
        h.min_reader_version = FORMAT_VERSION + 1;
        assert_eq!(VaultHeader::decode(&h.encode()), Err(VaultError::TooNew));

        let mut h = sample();
        h.min_reader_version = READER_VERSION + 1;
        assert_eq!(VaultHeader::decode(&h.encode()), Err(VaultError::TooNew));
    }

    #[test]
    fn unknown_fields_and_unpinned_settings_are_rejected() {
        let h = sample();
        let mut json: serde_json::Value = serde_json::to_value(&h).unwrap();
        json["surprise"] = serde_json::json!(true);
        let mut forged = h.clone();
        forged.db.page_size = 1024;
        for bytes in [reencode(&json), forged.encode()] {
            assert_eq!(
                VaultHeader::decode(&bytes),
                Err(VaultError::Corrupted(CorruptPart::Header))
            );
        }
    }

    #[test]
    fn kdf_below_floor_is_rejected_before_argon() {
        let mut h = sample();
        h.kdf.m_kib = 1024;
        let h = VaultHeader::decode(&h.encode()).unwrap();
        assert_eq!(
            h.password_slot().err(),
            Some(VaultError::Corrupted(CorruptPart::Header))
        );
    }

    #[test]
    fn aad_covers_everything_but_the_wrap() {
        let base = sample();
        let mut rewrapped = base.clone();
        rewrapped.set_wrap(&[9; NONCE_LEN], &[9; KEY_LEN + TAG_LEN]);
        assert_eq!(base.aad(), rewrapped.aad());

        let mutations: Vec<fn(&mut VaultHeader)> = vec![
            |h| h.kdf.m_kib += 1024,
            |h| h.kdf.t += 1,
            |h| h.kdf.p += 1,
            |h| h.kdf.salt_b64 = B64.encode([8; SALT_LEN]),
            |h| h.vault_id = uuid::Uuid::now_v7().to_string(),
            |h| h.demo = true,
            |h| h.created_at.push('x'),
        ];
        for m in mutations {
            let mut h = base.clone();
            m(&mut h);
            assert_ne!(base.aad(), h.aad());
        }
    }

    #[test]
    fn with_kdf_changes_only_the_kdf() {
        let base = sample();
        let params = KdfParams {
            m_kib: KdfParams::MINIMUM.m_kib * 2,
            ..KdfParams::MINIMUM
        };
        let next = base.with_kdf(params, &[8; SALT_LEN]);
        assert_eq!(next.kdf_params(), params);
        assert_eq!(next.kdf.salt_b64, B64.encode([8; SALT_LEN]));
        assert_eq!(
            (&next.vault_id, &next.created_at, next.demo),
            (&base.vault_id, &base.created_at, base.demo)
        );
        assert_ne!(next.aad(), base.aad());
    }

    fn reencode(json: &serde_json::Value) -> Vec<u8> {
        let body = serde_json::to_vec(json).unwrap();
        let mut out = MAGIC.to_vec();
        out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        out.extend_from_slice(&u32::try_from(body.len()).unwrap().to_le_bytes());
        out.extend_from_slice(&body);
        let crc = crc32fast::hash(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        out
    }
}
