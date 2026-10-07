//! Windows Hello keys (`KeyCredentialManager`).
//!
//! Each call blocks on a WinRT async operation, and `enroll` and `sign`
//! wait for the user to answer the Hello prompt, so none of this may run on
//! the UI thread.
//!
//! `KeyCredentialManager` has no way to name an owner window, so Windows
//! decides where the "Windows Security" prompt goes, and it can open behind
//! the app that asked. While a request waits, [`PromptInFront`] finds the
//! prompt and brings it forward.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{w, Array, HSTRING, PCWSTR};
use windows::Security::Credentials::{
    KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
};
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, FindWindowW, GetForegroundWindow, IsWindowVisible, SetForegroundWindow,
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};
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

/// How often the prompt is looked for, and for how long it is pushed
/// forward. After that the user is left alone: they may have switched away
/// on purpose.
const PROMPT_POLL: Duration = Duration::from_millis(50);
const PROMPT_PUSH_FOR: Duration = Duration::from_secs(5);
/// Plain `SetForegroundWindow` gets this long before the Alt-key nudge.
const PROMPT_NUDGE_AFTER: Duration = Duration::from_millis(400);

/// Brings the Hello prompt to the front for as long as a request waits.
/// Dropping it stops the search.
struct PromptInFront {
    done: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl PromptInFront {
    fn start() -> Self {
        let done = Arc::new(AtomicBool::new(false));
        let flag = done.clone();
        let thread = std::thread::Builder::new()
            .name("hello-prompt".into())
            .spawn(move || watch_prompt(&flag))
            .ok();
        Self { done, thread }
    }
}

impl Drop for PromptInFront {
    fn drop(&mut self) {
        self.done.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The prompt's window, once Windows has shown it.
fn find_prompt() -> Option<HWND> {
    // SAFETY: a window lookup by class name; the string is a static literal.
    let hwnd = unsafe { FindWindowW(w!("Credential Dialog Xaml Host"), PCWSTR::null()) }.ok()?;
    // SAFETY: `hwnd` was just returned by FindWindowW; a stale handle only
    // makes this return false.
    (!hwnd.is_invalid() && unsafe { IsWindowVisible(hwnd) }.as_bool()).then_some(hwnd)
}

fn watch_prompt(done: &AtomicBool) {
    let mut seen_at: Option<Instant> = None;
    let mut nudged = false;
    while !done.load(Ordering::SeqCst) {
        std::thread::sleep(PROMPT_POLL);
        let Some(prompt) = find_prompt() else {
            continue;
        };
        let since = *seen_at.get_or_insert_with(Instant::now);
        // SAFETY: plain window calls on a handle that is at worst stale, in
        // which case they fail and are ignored.
        unsafe {
            if GetForegroundWindow() == prompt {
                return;
            }
            if since.elapsed() > PROMPT_PUSH_FOR {
                return;
            }
            // Above our window even if Windows won't hand over the focus.
            let _ = SetWindowPos(
                prompt,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            let _ = BringWindowToTop(prompt);
            if SetForegroundWindow(prompt).as_bool() {
                continue;
            }
            // Windows refuses a focus change from a process it doesn't see
            // as the one in use. A tap of Alt counts as use (once is enough).
            if !nudged && since.elapsed() > PROMPT_NUDGE_AFTER {
                nudged = true;
                keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
                let _ = SetForegroundWindow(prompt);
                keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }
}

fn open(name: &str) -> Result<KeyCredential, HelloError> {
    let result = KeyCredentialManager::OpenAsync(&HSTRING::from(name))
        .and_then(|op| op.get())
        .map_err(failed("OpenAsync"))?;
    check(result.Status().map_err(failed("open status"))?, "open")?;
    result.Credential().map_err(failed("Credential"))
}

fn sign_with(key: &KeyCredential, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
    let data = CryptographicBuffer::CreateFromByteArray(challenge).map_err(failed("challenge"))?;
    let result = key
        .RequestSignAsync(&data)
        .and_then(|op| op.get())
        .map_err(failed("RequestSignAsync"))?;
    check(result.Status().map_err(failed("sign status"))?, "sign")?;

    let buffer = result.Result().map_err(failed("signature"))?;
    let mut bytes = Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(&buffer, &mut bytes).map_err(failed("CopyToByteArray"))?;
    let signature = Zeroizing::new(bytes.to_vec());
    // The signature is key material here. The WinRT buffer itself can't be
    // wiped, but our copy of it can.
    bytes.zeroize();
    Ok(signature)
}

impl QuickUnlockKey for WindowsHello {
    fn available(&self) -> HelloAvailability {
        match KeyCredentialManager::IsSupportedAsync().and_then(|op| op.get()) {
            Ok(true) => HelloAvailability::Available,
            Ok(false) => HelloAvailability::NotSetUp,
            Err(_) => HelloAvailability::Unsupported,
        }
    }

    fn enroll(&self, name: &str, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
        let _prompt = PromptInFront::start();
        let result = KeyCredentialManager::RequestCreateAsync(
            &HSTRING::from(name),
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .and_then(|op| op.get())
        .map_err(failed("RequestCreateAsync"))?;
        check(result.Status().map_err(failed("create status"))?, "create")?;
        // Sign with the credential the create call returned. Windows lets
        // it ride on the approval just given; one opened again by name is
        // asked for the PIN a second time.
        let key = result.Credential().map_err(failed("Credential"))?;
        sign_with(&key, challenge)
    }

    fn sign(&self, name: &str, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, HelloError> {
        let key = open(name)?;
        let _prompt = PromptInFront::start();
        sign_with(&key, challenge)
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

    /// Shows real Windows Hello prompts: approve all three, and check that
    /// each opens in front of the terminal. The first covers creating the
    /// key and its first signature.
    /// `cargo test -p vaultair-platform -- --ignored real_hello`
    #[test]
    #[ignore = "needs Windows Hello and someone to approve the prompts"]
    fn real_hello_signs_deterministically() {
        const NAME: &str = "Vaultair-test-0000";
        let hello = WindowsHello;
        assert_eq!(hello.available(), HelloAvailability::Available);
        let first = hello.enroll(NAME, &[7; 32]).unwrap();
        let second = hello.sign(NAME, &[7; 32]).unwrap();
        assert_eq!(*first, *second);
        assert_ne!(*first, *hello.sign(NAME, &[8; 32]).unwrap());
        hello.delete(NAME).unwrap();
        assert_eq!(
            hello.sign(NAME, &[7; 32]).err(),
            Some(HelloError::KeyNotFound)
        );
    }

    #[test]
    fn looking_for_a_prompt_that_is_not_there_stops_cleanly() {
        let watch = PromptInFront::start();
        std::thread::sleep(PROMPT_POLL * 3);
        drop(watch);
    }
}
