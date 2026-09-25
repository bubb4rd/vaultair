//! Cryptographic building blocks. See `docs/vault-format.md` for how they fit
//! together and `docs/adr/0002-crypto-and-storage.md` for why.
//!
//! Nothing here logs, and no error carries key or plaintext material.

pub mod aead;
pub mod envelope;
pub mod fingerprint;
pub mod kdf;
pub mod keys;
pub mod password;
pub mod rng;
pub mod totp;

/// Low-level crypto failures. Deliberately coarse: callers map these to
/// user-facing errors without learning *why* a decryption failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("the operating system's random number generator failed")]
    Rng,
    #[error("key derivation failed")]
    Kdf,
    #[error("KDF parameters are outside the accepted range")]
    KdfParamsRejected,
    #[error("encryption failed")]
    Encrypt,
    /// Wrong key, tampered ciphertext or AAD mismatch. Indistinguishable on purpose.
    #[error("decryption failed")]
    Decrypt,
    #[error("unsupported or malformed envelope")]
    MalformedEnvelope,
}

pub type CryptoResult<T> = Result<T, CryptoError>;
