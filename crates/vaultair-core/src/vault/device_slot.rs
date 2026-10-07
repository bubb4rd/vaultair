//! The quick-unlock device slot (ADR-0005): the vault's data key, wrapped
//! under a key that only a Windows Hello signature can rebuild.
//!
//! ```text
//! "VAULTAIRQU" (10) | version u16 LE | body_len u32 LE | JSON body | CRC32 u32 LE
//! ```
//!
//! Hello signs a random challenge with a key that never leaves it, and the
//! signature is the same every time. HKDF-SHA256 over that signature gives
//! the wrapping key, so nothing here opens without a Hello approval. The
//! wrap's AAD ties it to one vault and to the header as it was when quick
//! unlock was turned on: change the master password and the slot is void.
//!
//! The slot is a file on this device (`devices\<vault_id>.qu`), never part
//! of `vault.vhdr`, so it doesn't travel with the vault or its backups. The
//! caller wraps these bytes once more with DPAPI before writing them.
//!
//! The policy record (when the password was last typed, and in which
//! Windows session) carries a MAC keyed from the data key. Without the data
//! key it can be deleted but not moved forward.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use super::header::{VaultHeader, Wrap, WRAP_ALG};
use crate::crypto::aead::{self, NONCE_LEN, TAG_LEN};
use crate::crypto::kdf::KEY_LEN;
use crate::crypto::keys::Dek;
use crate::crypto::{rng, CryptoError};

pub const MAGIC: &[u8; 10] = b"VAULTAIRQU";
pub const SLOT_VERSION: u16 = 1;
pub const SLOT_EXTENSION: &str = "qu";
pub const CHALLENGE_LEN: usize = 32;
const SALT_LEN: usize = 32;
const BINDING_LEN: usize = 32;
const MAC_LEN: usize = 32;
/// A Hello signature is 256 bytes (RSA-2048). Anything much shorter isn't one.
const MIN_SIGNATURE_LEN: usize = 32;
const PREFIX_LEN: usize = 10 + 2 + 4;
const CRC_LEN: usize = 4;
const MAX_BODY_LEN: usize = 16 * 1024;

const INFO_WRAP: &[u8] = b"vaultair/v1/quick-unlock-wrap";
const BINDING_DOMAIN: &[u8] = b"vaultair-device-binding-v1\0";
const AAD_DOMAIN: &[u8] = b"vaultair-device-slot-aad-v1\0";
const MAC_DOMAIN: &[u8] = b"vaultair-device-policy-mac-v1\0";

/// Identifies a vault header exactly: its password slot, KDF and vault id.
pub type Binding = [u8; BINDING_LEN];

/// A hash of the header as written. It changes whenever the key is wrapped
/// again (a new master password or a stronger KDF).
pub fn header_binding(header: &VaultHeader) -> Binding {
    let mut hash = Sha256::new();
    hash.update(BINDING_DOMAIN);
    hash.update(header.encode());
    hash.finalize().into()
}

/// Where a vault's slot lives under `devices_dir`. `None` unless `vault_id`
/// is a UUID, so nothing else can become part of a path.
pub fn slot_path(devices_dir: &Path, vault_id: &str) -> Option<PathBuf> {
    let id = uuid::Uuid::parse_str(vault_id).ok()?;
    Some(devices_dir.join(format!("{}.{SLOT_EXTENSION}", id.as_hyphenated())))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SlotError {
    /// Not a slot file, or one this build can't read.
    #[error("the device slot is malformed")]
    Malformed,
    /// The wrap or the policy MAC didn't verify: a different signature, a
    /// different vault or header, or changed bytes. Indistinguishable on purpose.
    #[error("the device slot was rejected")]
    Rejected,
    #[error("crypto error: {0}")]
    Crypto(CryptoError),
}

impl From<CryptoError> for SlotError {
    fn from(e: CryptoError) -> Self {
        Self::Crypto(e)
    }
}

/// When the master password was last typed for this vault on this device.
/// Times are Unix seconds, UTC.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRecord {
    pub last_password_at: i64,
    /// When Windows started, as measured at that password unlock.
    pub boot_at: i64,
}

/// Everything in a slot file. None of it is secret on its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceSlot {
    vault_id: String,
    /// Lets a stale slot be noticed before asking for a Hello approval.
    /// The wrap's AAD is what enforces it.
    binding_b64: String,
    challenge_b64: String,
    salt_b64: String,
    wrap: Wrap,
    policy: PolicyRecord,
    policy_mac_b64: String,
    /// Hello attempts in a row that failed or were cancelled. Not
    /// authenticated: without the data key nothing here can be.
    failures: u8,
}

fn decode_fixed<const N: usize>(b64: &str) -> Result<[u8; N], SlotError> {
    B64.decode(b64)
        .ok()
        .and_then(|v| <[u8; N]>::try_from(v.as_slice()).ok())
        .ok_or(SlotError::Malformed)
}

fn wrap_key(signature: &[u8], salt: &[u8; SALT_LEN]) -> Result<Zeroizing<[u8; 32]>, SlotError> {
    if signature.len() < MIN_SIGNATURE_LEN {
        return Err(SlotError::Rejected);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(salt), signature)
        .expand(INFO_WRAP, key.as_mut())
        .map_err(|_| CryptoError::Kdf)?;
    Ok(key)
}

fn wrap_aad(
    vault_id: &str,
    binding: &Binding,
    challenge: &[u8; CHALLENGE_LEN],
    salt: &[u8; SALT_LEN],
) -> Vec<u8> {
    let mut aad = AAD_DOMAIN.to_vec();
    aad.extend_from_slice(vault_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(binding);
    aad.extend_from_slice(challenge);
    aad.extend_from_slice(salt);
    aad
}

fn policy_mac(
    policy_key: &[u8; 32],
    vault_id: &str,
    binding: &Binding,
    policy: PolicyRecord,
) -> [u8; MAC_LEN] {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(policy_key)
        .expect("HMAC accepts keys of any length");
    mac.update(MAC_DOMAIN);
    mac.update(vault_id.as_bytes());
    mac.update(&[0]);
    mac.update(binding);
    mac.update(&policy.last_password_at.to_le_bytes());
    mac.update(&policy.boot_at.to_le_bytes());
    mac.finalize().into_bytes().into()
}

impl DeviceSlot {
    /// A fresh challenge for Hello to sign before [`DeviceSlot::seal`].
    pub fn new_challenge() -> Result<[u8; CHALLENGE_LEN], SlotError> {
        Ok(rng::bytes::<CHALLENGE_LEN>()?)
    }

    /// Wraps `dek` under the key `signature` (Hello's signature over
    /// `challenge`) gives, for the vault whose header hashes to `binding`.
    pub fn seal(
        vault_id: &str,
        binding: &Binding,
        dek: &Dek,
        policy_key: &[u8; 32],
        challenge: &[u8; CHALLENGE_LEN],
        signature: &[u8],
        policy: PolicyRecord,
    ) -> Result<Self, SlotError> {
        let salt = rng::bytes::<SALT_LEN>()?;
        let key = wrap_key(signature, &salt)?;
        let (nonce, ciphertext) = aead::seal(
            &key,
            &wrap_aad(vault_id, binding, challenge, &salt),
            dek.as_bytes(),
        )?;
        Ok(Self {
            vault_id: vault_id.to_owned(),
            binding_b64: B64.encode(binding),
            challenge_b64: B64.encode(challenge),
            salt_b64: B64.encode(salt),
            wrap: Wrap {
                alg: WRAP_ALG.into(),
                nonce_b64: B64.encode(nonce),
                ct_b64: B64.encode(ciphertext),
            },
            policy,
            policy_mac_b64: B64.encode(policy_mac(policy_key, vault_id, binding, policy)),
            failures: 0,
        })
    }

    pub fn vault_id(&self) -> &str {
        &self.vault_id
    }

    /// The challenge Hello must sign to open this slot.
    pub fn challenge(&self) -> Result<[u8; CHALLENGE_LEN], SlotError> {
        decode_fixed(&self.challenge_b64)
    }

    /// Whether the slot was made for this vault and this header. A hint
    /// only; `open` is the check.
    pub fn is_for(&self, vault_id: &str, binding: &Binding) -> bool {
        self.vault_id == vault_id && self.binding_b64 == B64.encode(binding)
    }

    /// Unwraps the data key. `binding` comes from the header on disk now.
    pub fn open(&self, binding: &Binding, signature: &[u8]) -> Result<Dek, SlotError> {
        let challenge = self.challenge()?;
        let salt: [u8; SALT_LEN] = decode_fixed(&self.salt_b64)?;
        let nonce: [u8; NONCE_LEN] = decode_fixed(&self.wrap.nonce_b64)?;
        let ciphertext = B64
            .decode(&self.wrap.ct_b64)
            .map_err(|_| SlotError::Malformed)?;
        let key = wrap_key(signature, &salt)?;
        let dek = aead::open(
            &key,
            &nonce,
            &wrap_aad(&self.vault_id, binding, &challenge, &salt),
            &ciphertext,
        )
        .map_err(|_| SlotError::Rejected)?;
        Dek::from_bytes(&dek).map_err(|_| SlotError::Rejected)
    }

    /// The policy record as stored. Good enough to skip a pointless Hello
    /// prompt; trust it only after [`DeviceSlot::verified_policy`].
    pub fn policy_hint(&self) -> PolicyRecord {
        self.policy
    }

    /// The policy record, once its MAC checks out under the vault's key.
    pub fn verified_policy(
        &self,
        binding: &Binding,
        policy_key: &[u8; 32],
    ) -> Result<PolicyRecord, SlotError> {
        let stored: [u8; MAC_LEN] = decode_fixed(&self.policy_mac_b64)?;
        let expected = policy_mac(policy_key, &self.vault_id, binding, self.policy);
        if bool::from(stored.ct_eq(&expected)) {
            Ok(self.policy)
        } else {
            Err(SlotError::Rejected)
        }
    }

    /// Records a master-password unlock. Needs the unlocked vault's key.
    pub fn set_policy(&mut self, binding: &Binding, policy_key: &[u8; 32], policy: PolicyRecord) {
        self.policy = policy;
        self.policy_mac_b64 = B64.encode(policy_mac(policy_key, &self.vault_id, binding, policy));
    }

    pub fn failures(&self) -> u8 {
        self.failures
    }

    pub fn set_failures(&mut self, failures: u8) {
        self.failures = failures;
    }

    pub fn encode(&self) -> Vec<u8> {
        // Serializing plain structs of strings and integers can't fail.
        let body = serde_json::to_vec(self).unwrap_or_default();
        let mut out = Vec::with_capacity(PREFIX_LEN + body.len() + CRC_LEN);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&SLOT_VERSION.to_le_bytes());
        // Bodies are about 400 bytes; MAX_BODY_LEN keeps this well inside u32.
        #[allow(clippy::cast_possible_truncation)]
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        let crc = crc32fast::hash(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, SlotError> {
        if bytes.len() < PREFIX_LEN + CRC_LEN || &bytes[..10] != MAGIC {
            return Err(SlotError::Malformed);
        }
        if u16::from_le_bytes([bytes[10], bytes[11]]) != SLOT_VERSION {
            return Err(SlotError::Malformed);
        }
        let body_len = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
        if body_len > MAX_BODY_LEN || bytes.len() != PREFIX_LEN + body_len + CRC_LEN {
            return Err(SlotError::Malformed);
        }
        let (content, crc) = bytes.split_at(PREFIX_LEN + body_len);
        if crc32fast::hash(content).to_le_bytes() != crc {
            return Err(SlotError::Malformed);
        }
        let slot: Self =
            serde_json::from_slice(&content[PREFIX_LEN..]).map_err(|_| SlotError::Malformed)?;
        let ciphertext = B64
            .decode(&slot.wrap.ct_b64)
            .map_err(|_| SlotError::Malformed)?;
        let ok = slot.wrap.alg == WRAP_ALG
            && ciphertext.len() == KEY_LEN + TAG_LEN
            && uuid::Uuid::parse_str(&slot.vault_id).is_ok()
            && decode_fixed::<BINDING_LEN>(&slot.binding_b64).is_ok()
            && decode_fixed::<CHALLENGE_LEN>(&slot.challenge_b64).is_ok()
            && decode_fixed::<SALT_LEN>(&slot.salt_b64).is_ok()
            && decode_fixed::<NONCE_LEN>(&slot.wrap.nonce_b64).is_ok()
            && decode_fixed::<MAC_LEN>(&slot.policy_mac_b64).is_ok();
        if ok {
            Ok(slot)
        } else {
            Err(SlotError::Malformed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keys::VaultKeys;

    const VAULT_ID: &str = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const OTHER_ID: &str = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
    const BINDING: Binding = [3; 32];
    const CHALLENGE: [u8; CHALLENGE_LEN] = [7; 32];
    const POLICY: PolicyRecord = PolicyRecord {
        last_password_at: 1_790_000_000,
        boot_at: 1_789_990_000,
    };
    /// Stands in for the data key; the tests look for these bytes.
    const DEK_BYTES: [u8; 32] = *b"CANARY7F3A-dek-CANARY7F3A-dek-32";

    fn signature() -> Vec<u8> {
        vec![0x5A; 256]
    }

    fn keys() -> VaultKeys {
        VaultKeys::derive(Dek::from_bytes(&DEK_BYTES).unwrap()).unwrap()
    }

    fn sealed() -> DeviceSlot {
        let keys = keys();
        DeviceSlot::seal(
            VAULT_ID,
            &BINDING,
            keys.dek(),
            keys.device_policy_key(),
            &CHALLENGE,
            &signature(),
            POLICY,
        )
        .unwrap()
    }

    #[test]
    fn round_trip() {
        let slot = DeviceSlot::decode(&sealed().encode()).unwrap();
        assert!(slot.is_for(VAULT_ID, &BINDING));
        assert_eq!(slot.challenge().unwrap(), CHALLENGE);
        let dek = slot.open(&BINDING, &signature()).unwrap();
        assert_eq!(dek.as_bytes(), &DEK_BYTES);
        assert_eq!(
            slot.verified_policy(&BINDING, keys().device_policy_key()),
            Ok(POLICY)
        );
    }

    #[test]
    fn a_different_signature_is_rejected() {
        let slot = sealed();
        let mut other = signature();
        other[255] ^= 1;
        assert_eq!(slot.open(&BINDING, &other).err(), Some(SlotError::Rejected));
        assert_eq!(slot.open(&BINDING, &[]).err(), Some(SlotError::Rejected));
        assert_eq!(
            slot.open(&BINDING, &[0x5A; 16]).err(),
            Some(SlotError::Rejected)
        );
    }

    #[test]
    fn a_changed_header_is_rejected() {
        let slot = sealed();
        let after_password_change: Binding = [4; 32];
        assert!(!slot.is_for(VAULT_ID, &after_password_change));
        assert_eq!(
            slot.open(&after_password_change, &signature()).err(),
            Some(SlotError::Rejected)
        );
    }

    #[test]
    fn another_vaults_id_is_rejected() {
        let mut slot = sealed();
        slot.vault_id = OTHER_ID.into();
        assert_eq!(
            slot.open(&BINDING, &signature()).err(),
            Some(SlotError::Rejected)
        );
        assert_eq!(
            slot.verified_policy(&BINDING, keys().device_policy_key()),
            Err(SlotError::Rejected)
        );
    }

    #[test]
    fn every_changed_byte_is_caught() {
        let bytes = sealed().encode();
        for i in 0..bytes.len() {
            let mut bad = bytes.clone();
            bad[i] ^= 0x01;
            // The CRC catches accidental damage first.
            assert_eq!(
                DeviceSlot::decode(&bad).err(),
                Some(SlotError::Malformed),
                "byte {i}"
            );
        }
        assert_eq!(
            DeviceSlot::decode(&bytes[..bytes.len() - 1]).err(),
            Some(SlotError::Malformed)
        );
        assert_eq!(DeviceSlot::decode(&[]).err(), Some(SlotError::Malformed));
    }

    #[test]
    fn edits_that_keep_the_crc_valid_are_still_rejected() {
        let mutations: Vec<fn(&mut DeviceSlot)> = vec![
            |s| s.challenge_b64 = B64.encode([8u8; CHALLENGE_LEN]),
            |s| s.salt_b64 = B64.encode([8u8; SALT_LEN]),
            |s| s.wrap.nonce_b64 = B64.encode([8u8; NONCE_LEN]),
            |s| {
                let mut ct = B64.decode(&s.wrap.ct_b64).unwrap();
                ct[0] ^= 1;
                s.wrap.ct_b64 = B64.encode(ct);
            },
        ];
        for mutate in mutations {
            let mut slot = sealed();
            mutate(&mut slot);
            // Re-encoding recomputes the CRC, as a deliberate edit would.
            let slot = DeviceSlot::decode(&slot.encode()).unwrap();
            assert_eq!(
                slot.open(&BINDING, &signature()).err(),
                Some(SlotError::Rejected)
            );
        }
    }

    #[test]
    fn a_forged_policy_record_is_refused() {
        let keys = keys();
        let key = keys.device_policy_key();
        for forge in [
            (|p: &mut PolicyRecord| p.last_password_at += 86_400) as fn(&mut PolicyRecord),
            |p| p.boot_at += 3_600,
        ] {
            let mut slot = sealed();
            forge(&mut slot.policy);
            assert_eq!(
                slot.verified_policy(&BINDING, key),
                Err(SlotError::Rejected)
            );
        }

        // A MAC from another vault's key doesn't help either.
        let other = VaultKeys::derive(Dek::from_bytes(&[9; 32]).unwrap()).unwrap();
        let mut slot = sealed();
        slot.set_policy(
            &BINDING,
            other.device_policy_key(),
            PolicyRecord {
                last_password_at: POLICY.last_password_at + 86_400,
                ..POLICY
            },
        );
        assert_eq!(
            slot.verified_policy(&BINDING, key),
            Err(SlotError::Rejected)
        );
    }

    #[test]
    fn a_password_unlock_moves_the_policy_forward() {
        let keys = keys();
        let mut slot = sealed();
        let later = PolicyRecord {
            last_password_at: POLICY.last_password_at + 86_400,
            boot_at: POLICY.boot_at,
        };
        slot.set_policy(&BINDING, keys.device_policy_key(), later);
        assert_eq!(
            slot.verified_policy(&BINDING, keys.device_policy_key()),
            Ok(later)
        );
        // The wrap is untouched.
        assert!(slot.open(&BINDING, &signature()).is_ok());
    }

    #[test]
    fn the_data_key_never_appears_in_the_slot() {
        let slot = sealed();
        let bytes = slot.encode();
        let debug = format!("{slot:?}");
        for needle in [&DEK_BYTES[..], &b"CANARY7F3A"[..]] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
            assert!(!debug.as_bytes().windows(needle.len()).any(|w| w == needle));
        }
        assert!(!debug.contains(&B64.encode(DEK_BYTES)));
        // Nor does the signature it was wrapped under.
        assert!(!bytes.windows(32).any(|w| w == [0x5A; 32]));
    }

    #[test]
    fn slots_are_named_by_vault_id_only() {
        let dir = Path::new(r"C:\Users\x\AppData\Local\Vaultair\devices");
        assert_eq!(
            slot_path(dir, VAULT_ID),
            Some(dir.join(format!("{VAULT_ID}.qu")))
        );
        for bad in ["", "..", r"..\..\evil", "not-a-uuid", "a/b"] {
            assert_eq!(slot_path(dir, bad), None, "{bad}");
        }
    }

    #[test]
    fn the_binding_follows_the_header() {
        use crate::crypto::kdf::KdfParams;
        let mut header = VaultHeader::new(
            VAULT_ID.into(),
            "2026-10-06T00:00:00Z".into(),
            KdfParams::MINIMUM,
            &[7; 32],
            false,
        );
        header.set_wrap(&[1; NONCE_LEN], &[2; KEY_LEN + TAG_LEN]);
        let before = header_binding(&header);
        assert_eq!(before, header_binding(&header.clone()));

        let mut rewrapped = header.clone();
        rewrapped.set_wrap(&[9; NONCE_LEN], &[9; KEY_LEN + TAG_LEN]);
        assert_ne!(before, header_binding(&rewrapped));
        assert_ne!(
            before,
            header_binding(&header.with_kdf(KdfParams::MINIMUM, &[8; 32]))
        );
    }
}
