//! Single-open guard: an exclusive OS lock on `<vault>\.lock`, held for as
//! long as the vault is unlocked. Released automatically when the handle is
//! dropped or the process dies.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

use super::error::VaultError;

#[derive(Debug)]
pub struct VaultLock {
    _file: File,
}

impl VaultLock {
    pub fn acquire(path: &Path) -> Result<Self, VaultError> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(path)?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(TryLockError::WouldBlock) => Err(VaultError::InUse),
            Err(TryLockError::Error(e)) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_acquire_fails_until_first_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".lock");
        let first = VaultLock::acquire(&path).unwrap();
        assert_eq!(VaultLock::acquire(&path).err(), Some(VaultError::InUse));
        drop(first);
        assert!(VaultLock::acquire(&path).is_ok());
    }
}
