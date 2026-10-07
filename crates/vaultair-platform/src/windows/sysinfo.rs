//! The uptime and whether there is a TPM, for quick unlock.

use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::TpmBaseServices::{Tbsi_GetDeviceInfo, TPM_DEVICE_INFO};

use crate::SystemInfo;

const TBS_SUCCESS: u32 = 0;

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsSystem;

impl SystemInfo for WindowsSystem {
    /// With Fast Startup on, "Shut down" hibernates the kernel and this
    /// keeps counting; only "Restart" brings it back to zero.
    fn uptime_secs(&self) -> Option<u64> {
        // SAFETY: no arguments, no failure mode.
        Some(unsafe { GetTickCount64() } / 1000)
    }

    fn has_tpm(&self) -> bool {
        let mut info = TPM_DEVICE_INFO::default();
        // The struct is four u32s.
        #[allow(clippy::cast_possible_truncation)]
        let size = std::mem::size_of::<TPM_DEVICE_INFO>() as u32;
        // SAFETY: `info` is a valid, writable TPM_DEVICE_INFO of `size` bytes.
        let result = unsafe { Tbsi_GetDeviceInfo(size, std::ptr::from_mut(&mut info).cast()) };
        result == TBS_SUCCESS && info.tpmVersion != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uptime_is_readable_and_tpm_detection_does_not_crash() {
        let system = WindowsSystem;
        assert!(system.uptime_secs().is_some());
        // Either answer is fine; CI runners often have no TPM.
        let _ = system.has_tpm();
    }
}
