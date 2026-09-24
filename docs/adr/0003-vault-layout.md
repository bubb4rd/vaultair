# ADR-0003: Vault on-disk layout

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

SQLCipher needs a real random-access file, and the KDF parameters and wrapped key must be readable before the database can be opened. The spec also forbids uploading anything by default, and the user's Documents folder is synced to OneDrive.

## Decision

- **A vault is a folder**, not a single file:

  ```
  <location>\<VaultName>\
    vault.vhdr        header: magic "VAULTAIR", format_version u16, JSON body, CRC32 trailer
    vault.vdb         SQLCipher 4 database
    vault.vhdr.prev   only during a password change
    .lock             OS file lock held while open
  ```

- **Default location:** `%LOCALAPPDATA%\Vaultair\Vaults`. The app warns when a user picks a path inside a cloud-synced folder (OneDrive, Dropbox, Google Drive, iCloud).
- **Backups are single files** (`*.vaultair-backup`), so the folder layout doesn't affect portability.
- **One vault open at a time**, with a recent-vaults switcher. `tauri-plugin-single-instance` plus the `.lock` file prevent two processes opening the same vault.
- **Header integrity:** every header field except the slot ciphertext is AEAD-authenticated through the key wrap. A tampered KDF parameter or salt fails the unlock.
- **Key slots** (LUKS-style array) leave room for Windows Hello or a recovery-key slot later without a format change.
- **Atomic writes:** write `.tmp`, flush, then `ReplaceFileW`/`MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`.
- **Versioning:** header `format_version`, schema `user_version` + migrations, and a per-blob envelope version byte are independent. An automatic backup is created before any schema migration.
- **Never committed:** `.gitignore` and a CI check block `*.vdb`, `*.vhdr*` and `*.vaultair-backup`.

## Consequences

- Users see a folder, not a file. Help text and the backup flow must make that clear.
- Pre-unlock, only the header is readable, and it contains no user data.

Full detail: `docs/implementation-plan.md` §2.4.
