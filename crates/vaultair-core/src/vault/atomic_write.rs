//! Crash-safe file replacement: write a temp file, flush it to disk, then
//! rename it over the target. On Windows `std::fs::rename` is
//! `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`, which replaces atomically on
//! NTFS. (Adding `MOVEFILE_WRITE_THROUGH` would need `unsafe` in this crate;
//! the explicit `sync_all` before the rename covers the data.)

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

pub fn write_atomic(target: &Path, tmp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    {
        let mut f = File::create(tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(tmp, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_file_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("f");
        let tmp = dir.path().join("f.tmp");
        write_atomic(&target, &tmp, b"one").unwrap();
        write_atomic(&target, &tmp, b"two").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two");
        assert!(!tmp.exists());
    }
}
