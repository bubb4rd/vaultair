//! Changing the master password or the KDF: the same DEK is wrapped again
//! under a new key-encryption key. The database is never touched, so this
//! takes two Argon2 runs, not a re-encryption.
//!
//! The header is replaced so that a crash at any point leaves a `vault.vhdr`
//! that opens with either the old password or the new one:
//!
//! 1. copy `vault.vhdr` to `vault.vhdr.prev` and flush it;
//! 2. write the new header to `vault.vhdr.tmp`, flush it, rename it over
//!    `vault.vhdr` (atomic on NTFS);
//! 3. read the new header back; if it doesn't match, put `.prev` back;
//! 4. delete `.prev`.
//!
//! `.prev` still opens with the old password, so it is never kept: a crash
//! that leaves it (or a `.tmp`) behind is cleaned up on the next unlock.

use std::fs::{self, File};
use std::io::Write;

use rusqlite::params;
use secrecy::SecretString;

use super::error::{CorruptPart, VaultError};
use super::header::VaultHeader;
use super::layout::VaultPaths;
use super::OpenVault;
use crate::crypto::kdf::{self, KdfParams, SALT_LEN};
use crate::crypto::password::check_master_password;
use crate::crypto::{aead, rng};

/// Checks `current` against `header` and wraps the same DEK under `new`
/// (or `current` again, when only the KDF changes) with `kdf` and a fresh
/// salt. Slow (two Argon2 runs) and touches no files, so callers run it
/// without holding the session lock.
pub fn prepare_rewrap(
    header: &VaultHeader,
    current: &SecretString,
    new: Option<&SecretString>,
    kdf: KdfParams,
) -> Result<VaultHeader, VaultError> {
    if let Some(new) = new {
        check_master_password(new).map_err(VaultError::WeakPassword)?;
    }
    kdf.validate()?;
    let slot = header.password_slot()?;
    let old_kek = kdf::derive_kek(current, &slot.salt, slot.params)?;
    let dek = aead::open(&old_kek, &slot.nonce, &header.aad(), &slot.ciphertext)
        .map_err(|_| VaultError::WrongPasswordOrTampered)?;

    let salt = rng::bytes::<SALT_LEN>()?;
    let mut next = header.with_kdf(kdf, &salt);
    let new_kek = kdf::derive_kek(new.unwrap_or(current), &salt, kdf)?;
    let (nonce, wrapped) = aead::seal(&new_kek, &next.aad(), &dek)?;
    next.set_wrap(&nonce, &wrapped);
    Ok(next)
}

/// Writes `next` as the vault's header and records the new KDF summary.
/// `vault` must still have the header `next` was prepared from.
pub fn install_header(
    vault: &mut OpenVault,
    expected: &VaultHeader,
    next: VaultHeader,
    now: &str,
) -> Result<(), VaultError> {
    if &vault.header != expected || next.vault_id != expected.vault_id {
        // Another change landed in between. Nothing was written.
        return Err(VaultError::Io(std::io::ErrorKind::Interrupted));
    }
    replace_header(&vault.paths, &next, &mut |_| Ok(()))?;
    let summary = next.kdf_params().summary();
    vault.header = next;
    vault.conn.execute(
        "UPDATE vault_meta SET kdf_summary = ?1, updated_at = ?2 WHERE id = 'singleton'",
        params![summary, now],
    )?;
    tracing::info!(kdf = %summary, "vault key re-wrapped");
    Ok(())
}

/// Points in `replace_header` a test can stop at, as a crash would.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Step {
    PrevWritten,
    TmpWritten,
    Renamed,
}

fn write_synced(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = File::create(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

pub(crate) fn replace_header(
    paths: &VaultPaths,
    next: &VaultHeader,
    after: &mut dyn FnMut(Step) -> std::io::Result<()>,
) -> Result<(), VaultError> {
    let bytes = next.encode();
    let old = fs::read(&paths.header)?;
    write_synced(&paths.header_prev, &old)?;
    after(Step::PrevWritten)?;
    write_synced(&paths.header_tmp, &bytes)?;
    after(Step::TmpWritten)?;
    fs::rename(&paths.header_tmp, &paths.header)?;
    after(Step::Renamed)?;

    let read_back = fs::read(&paths.header)
        .ok()
        .and_then(|b| VaultHeader::decode(&b).ok());
    if read_back.as_ref() != Some(next) {
        tracing::error!("new vault header did not read back; restoring the previous one");
        fs::rename(&paths.header_prev, &paths.header)?;
        return Err(VaultError::Corrupted(CorruptPart::Header));
    }
    if let Err(e) = fs::remove_file(&paths.header_prev) {
        // The next unlock removes it.
        tracing::warn!(kind = ?e.kind(), "could not remove the previous vault header");
    }
    Ok(())
}

/// Removes what an interrupted header write left behind. Called once the
/// vault is unlocked (and its `.lock` held), so no write is in progress.
pub(crate) fn clean_leftovers(paths: &VaultPaths) {
    for leftover in [&paths.header_prev, &paths.header_tmp] {
        match fs::remove_file(leftover) {
            Ok(()) => tracing::info!("removed a header file left by an interrupted write"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!(kind = ?e.kind(), "could not remove a leftover header file"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::SystemClock;
    use crate::vault::{create_vault, open_vault, CreateOptions};

    const OLD: &str = "orbit lantern cactus mosaic";
    const NEW: &str = "velvet harbor quartz meadow";

    fn pw(s: &str) -> SecretString {
        SecretString::from(s)
    }

    fn new_vault() -> (tempfile::TempDir, std::path::PathBuf) {
        let parent = tempfile::tempdir().unwrap();
        let vault = create_vault(
            &CreateOptions {
                parent_dir: parent.path().to_path_buf(),
                name: "Rekey".into(),
                kdf: KdfParams::MINIMUM,
                demo: false,
            },
            &pw(OLD),
            &SystemClock,
        )
        .unwrap();
        let dir = vault.dir().clone();
        drop(vault);
        (parent, dir)
    }

    fn opens(dir: &std::path::Path, password: &str) -> bool {
        match open_vault(dir, &pw(password)) {
            Ok(_) => true,
            Err(VaultError::WrongPasswordOrTampered) => false,
            Err(e) => panic!("unexpected error: {e}"),
        }
    }

    /// Prepares a change to `NEW` and stops after `crash_at`, as if the
    /// process died there.
    fn change_and_crash(dir: &std::path::Path, crash_at: Step) {
        let vault = open_vault(dir, &pw(OLD)).unwrap();
        let next =
            prepare_rewrap(&vault.header, &pw(OLD), Some(&pw(NEW)), KdfParams::MINIMUM).unwrap();
        let result = replace_header(&vault.paths, &next, &mut |step| {
            if step == crash_at {
                Err(std::io::Error::other("simulated crash"))
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn new_password_opens_and_old_does_not() {
        let (_parent, dir) = new_vault();
        let mut vault = open_vault(&dir, &pw(OLD)).unwrap();
        let before = vault.header.clone();
        let next = prepare_rewrap(&before, &pw(OLD), Some(&pw(NEW)), KdfParams::MINIMUM).unwrap();
        install_header(&mut vault, &before, next, "2026-10-05T00:00:00Z").unwrap();
        // The open vault keeps working: same DEK, same database.
        assert!(vault.integrity_check().unwrap().ok);
        drop(vault);

        assert!(opens(&dir, NEW));
        assert!(!opens(&dir, OLD));
        let paths = VaultPaths::new(&dir);
        assert!(!paths.header_prev.exists() && !paths.header_tmp.exists());
    }

    #[test]
    fn wrong_current_password_changes_nothing() {
        let (_parent, dir) = new_vault();
        let vault = open_vault(&dir, &pw(OLD)).unwrap();
        let before = std::fs::read(&vault.paths.header).unwrap();
        assert_eq!(
            prepare_rewrap(&vault.header, &pw(NEW), Some(&pw(NEW)), KdfParams::MINIMUM).err(),
            Some(VaultError::WrongPasswordOrTampered)
        );
        assert_eq!(std::fs::read(&vault.paths.header).unwrap(), before);
    }

    #[test]
    fn weak_new_password_is_refused_before_any_work() {
        let (_parent, dir) = new_vault();
        let vault = open_vault(&dir, &pw(OLD)).unwrap();
        assert!(matches!(
            prepare_rewrap(
                &vault.header,
                &pw(OLD),
                Some(&pw("short")),
                KdfParams::MINIMUM
            ),
            Err(VaultError::WeakPassword(_))
        ));
    }

    #[test]
    fn crash_after_writing_tmp_leaves_the_original_header() {
        let (_parent, dir) = new_vault();
        change_and_crash(&dir, Step::TmpWritten);
        let paths = VaultPaths::new(&dir);
        assert!(paths.header_tmp.exists() && paths.header_prev.exists());

        assert!(!opens(&dir, NEW));
        assert!(opens(&dir, OLD));
        // That unlock cleaned up, so the old header copy doesn't linger.
        assert!(!paths.header_tmp.exists() && !paths.header_prev.exists());
    }

    #[test]
    fn crash_after_rename_leaves_the_new_header() {
        let (_parent, dir) = new_vault();
        change_and_crash(&dir, Step::Renamed);
        let paths = VaultPaths::new(&dir);
        assert!(paths.header_prev.exists());

        assert!(!opens(&dir, OLD));
        assert!(opens(&dir, NEW));
        assert!(!paths.header_prev.exists());
    }

    #[test]
    fn crash_after_copying_prev_leaves_the_original_header() {
        let (_parent, dir) = new_vault();
        change_and_crash(&dir, Step::PrevWritten);
        assert!(opens(&dir, OLD));
    }

    #[test]
    fn strengthening_keeps_the_password_and_records_the_kdf() {
        let (_parent, dir) = new_vault();
        let mut vault = open_vault(&dir, &pw(OLD)).unwrap();
        let stronger = KdfParams {
            m_kib: KdfParams::MINIMUM.m_kib + 8 * 1024,
            ..KdfParams::MINIMUM
        };
        let before = vault.header.clone();
        let next = prepare_rewrap(&before, &pw(OLD), None, stronger).unwrap();
        install_header(&mut vault, &before, next, "2026-10-05T00:00:00Z").unwrap();
        assert_eq!(vault.info().kdf_summary, stronger.summary());
        let stored: String = vault
            .conn()
            .query_row("SELECT kdf_summary FROM vault_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, stronger.summary());
        drop(vault);

        let reopened = open_vault(&dir, &pw(OLD)).unwrap();
        assert_eq!(reopened.header.kdf_params(), stronger);
    }

    #[test]
    fn a_stale_header_is_refused() {
        let (_parent, dir) = new_vault();
        let mut vault = open_vault(&dir, &pw(OLD)).unwrap();
        let before = vault.header.clone();
        let first = prepare_rewrap(&before, &pw(OLD), Some(&pw(NEW)), KdfParams::MINIMUM).unwrap();
        let second = prepare_rewrap(&before, &pw(OLD), Some(&pw(NEW)), KdfParams::MINIMUM).unwrap();
        install_header(&mut vault, &before, first, "2026-10-05T00:00:00Z").unwrap();
        assert!(install_header(&mut vault, &before, second, "2026-10-05T00:00:00Z").is_err());
    }
}
