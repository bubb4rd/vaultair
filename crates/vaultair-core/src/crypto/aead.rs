//! XChaCha20-Poly1305 with random 24-byte nonces (collision risk negligible).

use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use super::{rng, CryptoError, CryptoResult};

pub const NONCE_LEN: usize = 24;
pub const TAG_LEN: usize = 16;

fn cipher(key: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(&(*key).into())
}

/// Encrypts with a fresh random nonce. Returns `(nonce, ciphertext || tag)`.
pub fn seal(
    key: &[u8; 32],
    aad: &[u8],
    plaintext: &[u8],
) -> CryptoResult<([u8; NONCE_LEN], Vec<u8>)> {
    let nonce = rng::bytes::<NONCE_LEN>()?;
    let ct = cipher(key)
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Encrypt)?;
    Ok((nonce, ct))
}

pub fn open(
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> CryptoResult<Zeroizing<Vec<u8>>> {
    cipher(key)
        .decrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| CryptoError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_tamper_detection() {
        let key = [7u8; 32];
        let (nonce, ct) = seal(&key, b"aad", b"secret").unwrap();
        assert_eq!(ct.len(), 6 + TAG_LEN);
        assert_eq!(
            open(&key, &nonce, b"aad", &ct).unwrap().as_slice(),
            b"secret"
        );

        assert_eq!(
            open(&key, &nonce, b"other", &ct).err(),
            Some(CryptoError::Decrypt)
        );
        assert_eq!(
            open(&[8u8; 32], &nonce, b"aad", &ct).err(),
            Some(CryptoError::Decrypt)
        );
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert_eq!(
            open(&key, &nonce, b"aad", &bad).err(),
            Some(CryptoError::Decrypt)
        );
        let mut bad_nonce = nonce;
        bad_nonce[0] ^= 1;
        assert_eq!(
            open(&key, &bad_nonce, b"aad", &ct).err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn nonces_are_fresh() {
        let key = [1u8; 32];
        let (a, _) = seal(&key, b"", b"x").unwrap();
        let (b, _) = seal(&key, b"", b"x").unwrap();
        assert_ne!(a, b);
    }
}
