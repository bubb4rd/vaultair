//! DPAPI (`CryptProtectData`) for the signed-in user, never with a prompt.
//!
//! Any process running as the same user can undo it. Quick unlock uses it
//! only as an outer layer over a slot that already needs a Windows Hello
//! signature to open (ADR-0005).

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use super::os;
use crate::{DeviceProtection, PlatformError};

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsDpapi;

fn blob(bytes: &[u8]) -> Result<CRYPT_INTEGER_BLOB, PlatformError> {
    Ok(CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| PlatformError::Os {
            context: "blob too large",
        })?,
        // DPAPI only reads its inputs; the API just isn't const-correct.
        pbData: bytes.as_ptr().cast_mut(),
    })
}

/// Copies DPAPI's output out, wipes it and frees it.
///
/// # Safety
/// `out` must be a blob a successful DPAPI call just filled in.
unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    if out.pbData.is_null() {
        return Vec::new();
    }
    let len = out.cbData as usize;
    // SAFETY: DPAPI allocated `len` bytes at `pbData` with LocalAlloc and
    // handed them to us; nothing else refers to them.
    unsafe {
        let bytes = std::slice::from_raw_parts(out.pbData, len).to_vec();
        std::ptr::write_bytes(out.pbData, 0, len);
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        bytes
    }
}

impl DeviceProtection for WindowsDpapi {
    fn protect(&self, plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError> {
        let (input, entropy) = (blob(plain)?, blob(entropy)?);
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: both blobs point at slices that outlive the call, and
        // `out` is ours to receive the result.
        unsafe {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
            .map_err(os("CryptProtectData"))?;
            Ok(take(out))
        }
    }

    fn unprotect(&self, protected: &[u8], entropy: &[u8]) -> Result<Vec<u8>, PlatformError> {
        let (input, entropy) = (blob(protected)?, blob(entropy)?);
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as in `protect`.
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
            .map_err(os("CryptUnprotectData"))?;
            Ok(take(out))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_is_bound_to_the_entropy() {
        let dpapi = WindowsDpapi;
        let plain = b"VAULTAIRQU slot bytes";
        let protected = dpapi.protect(plain, b"vault-a").unwrap();
        assert!(!protected.windows(plain.len()).any(|w| w == plain));
        assert_eq!(dpapi.unprotect(&protected, b"vault-a").unwrap(), plain);
        assert!(dpapi.unprotect(&protected, b"vault-b").is_err());
    }

    #[test]
    fn changed_bytes_are_refused() {
        let dpapi = WindowsDpapi;
        let mut protected = dpapi.protect(b"slot", b"vault-a").unwrap();
        let last = protected.len() - 1;
        protected[last] ^= 0x01;
        assert!(dpapi.unprotect(&protected, b"vault-a").is_err());
        assert!(dpapi.unprotect(b"not a dpapi blob", b"vault-a").is_err());
    }
}
