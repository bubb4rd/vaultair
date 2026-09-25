//! Password and passphrase generator (implementation plan, Phase 6).
//!
//! All randomness comes from the OS (`getrandom`), every choice is unbiased
//! (see `random.rs`), and "at least one of each class" is met by redrawing the
//! whole password, never by planting characters at chosen positions.

mod passphrase;
mod password;
mod random;
pub mod strength;

use serde::Serialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::crypto::CryptoError;
use crate::AppError;

pub use passphrase::{generate_passphrase, PassphraseOptions, WORDLIST_LEN};
pub use password::{generate_password, PasswordOptions, AMBIGUOUS, SYMBOLS};

/// A freshly generated value and how strong it is. The value is wiped from
/// memory when this is dropped (after it's serialized to the UI).
#[derive(Clone, PartialEq, Serialize, Zeroize, ZeroizeOnDrop)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    pub value: String,
    /// Exact entropy of the generator's output space, in bits.
    #[zeroize(skip)]
    pub entropy_bits: f64,
    /// zxcvbn score, 0 (trivial) to 4 (very strong).
    #[zeroize(skip)]
    pub score: u8,
}

impl std::fmt::Debug for Generated {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Generated")
            .field("value", &"<redacted>")
            .field("entropy_bits", &self.entropy_bits)
            .field("score", &self.score)
            .finish()
    }
}

fn rng_err(_: CryptoError) -> AppError {
    AppError::Internal { context: "rng" }
}
