//! Unbiased uniform choice from OS randomness.
//!
//! `x % n` on raw random bytes favors small values whenever `n` doesn't divide
//! 2^32, so values from the uneven tail are rejected and redrawn instead.

use zeroize::Zeroizing;

use crate::crypto::{rng, CryptoResult};

/// Bytes fetched from the OS per refill. Wiped on drop: they determine the
/// generated value.
const BUF_LEN: usize = 64;

/// Draws uniform indices. `S` fills a buffer with random bytes; production
/// uses the OS generator, tests inject fixed bytes.
pub(crate) struct Uniform<S> {
    source: S,
    buf: Zeroizing<[u8; BUF_LEN]>,
    pos: usize,
}

impl<S> std::fmt::Debug for Uniform<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Uniform")
    }
}

/// Fills a buffer with random bytes.
pub(crate) type ByteSource = fn(&mut [u8]) -> CryptoResult<()>;

pub(crate) fn os() -> Uniform<ByteSource> {
    Uniform::new(rng::fill)
}

impl<S: FnMut(&mut [u8]) -> CryptoResult<()>> Uniform<S> {
    pub(crate) fn new(source: S) -> Self {
        Self {
            source,
            buf: Zeroizing::new([0; BUF_LEN]),
            pos: BUF_LEN,
        }
    }

    fn next_u32(&mut self) -> CryptoResult<u32> {
        if self.pos + 4 > BUF_LEN {
            (self.source)(self.buf.as_mut())?;
            self.pos = 0;
        }
        let mut word = [0u8; 4];
        word.copy_from_slice(&self.buf[self.pos..self.pos + 4]);
        self.pos += 4;
        Ok(u32::from_le_bytes(word))
    }

    /// A uniform value in `0..n`. `n` must be non-zero.
    pub(crate) fn below(&mut self, n: u32) -> CryptoResult<u32> {
        assert!(n > 0, "empty range");
        let n64 = u64::from(n);
        // Largest multiple of n that fits in 2^32; draws at or above it are redrawn.
        let accept_below = (1u64 << 32) / n64 * n64;
        loop {
            let x = u64::from(self.next_u32()?);
            if x < accept_below {
                // x % n < n <= u32::MAX, so this never truncates.
                return Ok(u32::try_from(x % n64).unwrap_or(0));
            }
        }
    }

    /// A uniformly chosen element. `items` must be non-empty and shorter than 2^32.
    pub(crate) fn pick<'a, T>(&mut self, items: &'a [T]) -> CryptoResult<&'a T> {
        let n = u32::try_from(items.len()).expect("slice too long");
        let i = self.below(n)? as usize;
        Ok(&items[i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A source that yields `words` in order (as little-endian u32s), then zeros.
    fn scripted(words: &[u32]) -> Uniform<impl FnMut(&mut [u8]) -> CryptoResult<()>> {
        let mut bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        Uniform::new(move |buf: &mut [u8]| {
            let take = bytes.len().min(buf.len());
            buf.fill(0);
            buf[..take].copy_from_slice(&bytes[..take]);
            bytes.drain(..take);
            Ok(())
        })
    }

    #[test]
    fn rejects_the_uneven_tail() {
        // 2^32 = 3 * 1431655765 + 1, so only u32::MAX is outside the even zone for n = 3.
        let mut u = scripted(&[u32::MAX, 7]);
        assert_eq!(u.below(3).unwrap(), 7 % 3);
    }

    #[test]
    fn accepts_the_last_even_value() {
        let mut u = scripted(&[u32::MAX - 1]);
        assert_eq!(u.below(3).unwrap(), (u32::MAX - 1) % 3);
    }

    #[test]
    fn powers_of_two_never_reject() {
        let mut u = scripted(&[u32::MAX, 5]);
        assert_eq!(u.below(4).unwrap(), 3);
        assert_eq!(u.below(4).unwrap(), 1);
    }

    #[test]
    fn rng_failure_propagates() {
        let mut u = Uniform::new(|_: &mut [u8]| Err(crate::crypto::CryptoError::Rng));
        assert!(u.below(10).is_err());
    }

    #[test]
    fn os_draws_stay_in_range() {
        let mut u = os();
        for n in [1, 2, 3, 7, 26, 7776, u32::MAX] {
            for _ in 0..200 {
                assert!(u.below(n).unwrap() < n);
            }
        }
    }
}
