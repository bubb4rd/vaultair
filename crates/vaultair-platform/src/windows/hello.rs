//! Windows Hello keys (`KeyCredentialManager`).
//!
//! Each call blocks on a WinRT async operation, and `enroll` and `sign`
//! wait for the user to answer the Hello prompt, so none of this may run on
//! the UI thread. The prompt takes the foreground by itself; no focus
//! workaround is needed (see `docs/spikes/hello-quick-unlock.md`).

use windows::core::{Array, HSTRING};
use windows::Security::Credentials::{
    KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
};
use windows::Security::Cryptography::CryptographicBuffer;
use zeroize::{Zeroize, Zeroizing};

use crate::{HelloAvailability, HelloError, QuickUnlockKey};

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsHello;

fn failed(context: &'static str) -> impl FnOnce(windows::core::Error) -> HelloError {
    move |_| HelloError::Failed { context }
}

/// A status has to be checked before the result is read: reading the
/// credential or the signature of a failed result fails with `HRESULT(0)`.
fn check(status: KeyCredentialStatus, context: &'static str) -> Result<(), HelloError> {
    match status {
        KeyCredentialStatus::Success => Ok(()),
        KeyCredentialStatus::UserCanceled | KeyCredentialStatus::UserPrefersPassword => {
            Err(HelloError::Cancelled)
        }
        KeyCredentialStatus::NotFound => Err(HelloError::KeyNotFound),
        _ => Err(HelloError::Failed { context }),
    }
}

fn open(name: &str) -> Result<KeyCredential, HelloError> {
    let result = KeyCredentialManager::OpenAsync(&HSTRING::from(name))
        .and_then(|op| op.get())
        .map_err(failed("OpenAsync"))?;
    check(result.Status().map_err(failed("open status"))?, "open")?;
    result.Credential().map_err(failed("Credential"))
}

impl QuickUnlockKey for WindowsHello {
    fn available(&self) -> HelloAvailability {
        match KeyCredentialManager::IsSupportedAsync().and_then(|op| op.get()) {
            Ok(true) => HelloAvailability::Available,
            Ok(false) => HelloAvailability::NotSetUp,
            Err(_) => HelloAvailability::Unsupported,
        }
    }

    fn enroll(&self, name: &str) -> Result<(), HelloError> {
        let result = KeyCredentialManager::RequestCreateAsync(
            &HSTRING::from(name),
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .and_then(|op| op.get())
        .map_err(failed("RequestCreateAsync"))?;
        check(result.Status().map_err(failed("create status"))?, "create")
    }

    fn sign(&self, name: &str, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
        let key = open(name)?;
        let data =
            CryptographicBuffer::CreateFromByteArray(challenge).map_err(failed("challenge"))?;
        let result = key
            .RequestSignAsync(&data)
            .and_then(|op| op.get())
            .map_err(failed("RequestSignAsync"))?;
        check(result.Status().map_err(failed("sign status"))?, "sign")?;

        let buffer = result.Result().map_err(failed("signature"))?;
        let mut bytes = Array::<u8>::new();
        CryptographicBuffer::CopyToByteArray(&buffer, &mut bytes)
            .map_err(failed("CopyToByteArray"))?;
        let signature = Zeroizing::new(bytes.to_vec());
        // The signature is key material here. The WinRT buffer itself can't
        // be wiped, but our copy of it can.
        bytes.zeroize();
        Ok(signature)
    }

    fn delete(&self, name: &str) -> Result<(), HelloError> {
        // Fails when there is no such key, which is the state asked for.
        let _ = KeyCredentialManager::DeleteAsync(&HSTRING::from(name)).and_then(|op| op.get());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shows real Windows Hello prompts: approve all three.
    /// `cargo test -p vaultair-platform -- --ignored real_hello`
    #[test]
    #[ignore = "needs Windows Hello and someone to approve the prompts"]
    fn real_hello_signs_deterministically() {
        const NAME: &str = "Vaultair-test-0000";
        let hello = WindowsHello;
        assert_eq!(hello.available(), HelloAvailability::Available);
        hello.enroll(NAME).unwrap();
        let first = hello.sign(NAME, &[7; 32]).unwrap();
        let second = hello.sign(NAME, &[7; 32]).unwrap();
        assert_eq!(*first, *second);
        assert_ne!(*first, *hello.sign(NAME, &[8; 32]).unwrap());
        hello.delete(NAME).unwrap();
        assert_eq!(
            hello.sign(NAME, &[7; 32]).err(),
            Some(HelloError::KeyNotFound)
        );
    }
}
