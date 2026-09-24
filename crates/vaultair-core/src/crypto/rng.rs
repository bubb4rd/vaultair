//! OS randomness (`BCryptGenRandom` on Windows, via `getrandom`).

use zeroize::Zeroizing;

use super::{CryptoError, CryptoResult};

pub fn fill(buf: &mut [u8]) -> CryptoResult<()> {
    getrandom::fill(buf).map_err(|_| CryptoError::Rng)
}

pub fn bytes<const N: usize>() -> CryptoResult<[u8; N]> {
    let mut out = [0u8; N];
    fill(&mut out)?;
    Ok(out)
}

/// Random key material that is wiped when dropped.
pub fn secret_bytes<const N: usize>() -> CryptoResult<Zeroizing<[u8; N]>> {
    let mut out = Zeroizing::new([0u8; N]);
    fill(out.as_mut())?;
    Ok(out)
}
