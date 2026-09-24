//! Argon2id key derivation for the master password.
//!
//! Parameters are calibrated per device at vault creation and stored in the
//! header. On read, they are checked against floors (so a tampered header
//! can't force a weak KDF) and caps (so it can't force a huge allocation)
//! *before* Argon2 runs.

use std::time::{Duration, Instant};

use argon2::{Algorithm, Argon2, Params, Version};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{rng, CryptoError, CryptoResult};

pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 32;

/// RFC 9106 second recommended option: 64 MiB, t = 3, p = 4.
pub const MIN_M_KIB: u32 = 64 * 1024;
pub const MIN_T: u32 = 3;
pub const MIN_P: u32 = 1;
/// Upper bounds accepted from a header (anti-DoS).
pub const MAX_M_KIB: u32 = 2 * 1024 * 1024;
pub const MAX_T: u32 = 64;
pub const MAX_P: u32 = 16;
/// Calibration never picks more than this.
pub const CALIBRATE_MAX_M_KIB: u32 = 512 * 1024;
pub const DEFAULT_T: u32 = 3;
pub const DEFAULT_P: u32 = 4;
/// Calibration aims for roughly this unlock time.
pub const CALIBRATE_TARGET: Duration = Duration::from_millis(850);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

impl KdfParams {
    /// The floor. Also used by tests and the golden fixture.
    pub const MINIMUM: Self = Self {
        m_kib: MIN_M_KIB,
        t: MIN_T,
        p: DEFAULT_P,
    };

    pub fn validate(&self) -> CryptoResult<()> {
        let ok = (MIN_M_KIB..=MAX_M_KIB).contains(&self.m_kib)
            && (MIN_T..=MAX_T).contains(&self.t)
            && (MIN_P..=MAX_P).contains(&self.p)
            // Argon2 requires at least 8 KiB per lane.
            && self.m_kib >= 8 * self.p;
        if ok {
            Ok(())
        } else {
            Err(CryptoError::KdfParamsRejected)
        }
    }

    /// e.g. "Argon2id 128 MiB, t=3, p=4" (for display; not secret).
    pub fn summary(&self) -> String {
        format!(
            "Argon2id {} MiB, t={}, p={}",
            self.m_kib / 1024,
            self.t,
            self.p
        )
    }
}

/// Master passwords are compared after Unicode NFC normalisation, so the
/// same passphrase typed on different keyboards/IMEs derives the same key.
pub(crate) fn normalize(password: &SecretString) -> Zeroizing<String> {
    use unicode_normalization::UnicodeNormalization;
    Zeroizing::new(password.expose_secret().nfc().collect())
}

/// Derives the 32-byte key-encryption key. Validates `params` first.
pub fn derive_kek(
    password: &SecretString,
    salt: &[u8],
    params: KdfParams,
) -> CryptoResult<Zeroizing<[u8; KEY_LEN]>> {
    params.validate()?;
    let argon_params = Params::new(params.m_kib, params.t, params.p, Some(KEY_LEN))
        .map_err(|_| CryptoError::KdfParamsRejected)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let normalized = normalize(password);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(normalized.as_bytes(), salt, out.as_mut())
        .map_err(|_| CryptoError::Kdf)?;
    Ok(out)
}

/// Picks parameters that take about `target` on this machine: t and p fixed,
/// memory scaled from one measurement at the floor, clamped to
/// [64 MiB, 512 MiB] and rounded down to a multiple of 8 MiB.
pub fn calibrate(target: Duration) -> CryptoResult<KdfParams> {
    let probe = KdfParams {
        m_kib: MIN_M_KIB,
        t: DEFAULT_T,
        p: DEFAULT_P,
    };
    let salt = rng::bytes::<SALT_LEN>()?;
    let dummy = SecretString::from("vaultair-calibration-probe");
    let start = Instant::now();
    derive_kek(&dummy, &salt, probe)?;
    let elapsed = start.elapsed().max(Duration::from_millis(1));

    let scale = target.as_secs_f64() / elapsed.as_secs_f64();
    let ideal =
        (f64::from(MIN_M_KIB) * scale).clamp(f64::from(MIN_M_KIB), f64::from(CALIBRATE_MAX_M_KIB));
    let step = 8 * 1024;
    // `ideal` is clamped to [64 MiB, 512 MiB] in KiB, so it fits a u32.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let m_kib = (ideal as u32) / step * step;
    Ok(KdfParams {
        m_kib: m_kib.max(MIN_M_KIB),
        ..probe
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floors_and_caps_are_enforced() {
        assert!(KdfParams::MINIMUM.validate().is_ok());
        let bad = [
            KdfParams {
                m_kib: MIN_M_KIB - 1,
                ..KdfParams::MINIMUM
            },
            KdfParams {
                t: 2,
                ..KdfParams::MINIMUM
            },
            KdfParams {
                p: 0,
                ..KdfParams::MINIMUM
            },
            KdfParams {
                m_kib: MAX_M_KIB + 1,
                ..KdfParams::MINIMUM
            },
            KdfParams {
                t: MAX_T + 1,
                ..KdfParams::MINIMUM
            },
            KdfParams {
                p: MAX_P + 1,
                ..KdfParams::MINIMUM
            },
        ];
        for params in bad {
            assert_eq!(
                params.validate(),
                Err(CryptoError::KdfParamsRejected),
                "{params:?}"
            );
            // derive_kek refuses before doing any work.
            let r = derive_kek(&SecretString::from("x"), &[0; SALT_LEN], params);
            assert_eq!(r.err(), Some(CryptoError::KdfParamsRejected));
        }
    }

    #[test]
    fn same_inputs_same_key_different_salt_different_key() {
        let pw = SecretString::from("correct horse battery staple");
        let a = derive_kek(&pw, &[1; SALT_LEN], KdfParams::MINIMUM).unwrap();
        let b = derive_kek(&pw, &[1; SALT_LEN], KdfParams::MINIMUM).unwrap();
        let c = derive_kek(&pw, &[2; SALT_LEN], KdfParams::MINIMUM).unwrap();
        assert_eq!(*a, *b);
        assert_ne!(*a, *c);
    }

    #[test]
    fn password_is_nfc_normalized() {
        // "é" as one code point vs "e" + combining acute accent.
        let composed = SecretString::from("caf\u{e9} passphrase");
        let decomposed = SecretString::from("cafe\u{301} passphrase");
        let a = derive_kek(&composed, &[3; SALT_LEN], KdfParams::MINIMUM).unwrap();
        let b = derive_kek(&decomposed, &[3; SALT_LEN], KdfParams::MINIMUM).unwrap();
        assert_eq!(*a, *b);
    }

    #[test]
    fn calibration_stays_in_bounds() {
        for target in [
            Duration::from_millis(1),
            CALIBRATE_TARGET,
            Duration::from_secs(60),
        ] {
            let p = calibrate(target).unwrap();
            assert!(p.validate().is_ok());
            assert!(
                (MIN_M_KIB..=CALIBRATE_MAX_M_KIB).contains(&p.m_kib),
                "{p:?}"
            );
            assert_eq!(p.m_kib % (8 * 1024), 0);
            assert_eq!((p.t, p.p), (DEFAULT_T, DEFAULT_P));
        }
    }

    #[test]
    fn summary_is_readable() {
        assert_eq!(KdfParams::MINIMUM.summary(), "Argon2id 64 MiB, t=3, p=4");
    }
}
