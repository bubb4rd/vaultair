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

## As built (checked in Phase 16)

The decision stands. Where the code differs from the list above:

- **Key slots did not avoid a format change.** The header has the `key_slots` array, but the v1 reader accepts exactly one slot, of kind `password`, and refuses anything else as a damaged header. A second slot needs a new `format_version` so that older builds say "too new" (`docs/vault-format.md` §2). Windows Hello unlock did not use a header slot at all: it is a device file outside the vault ([ADR-0005](0005-quick-unlock.md)).
- **Atomic writes** are `std::fs::rename` after `sync_all`, which on Windows is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`. `MOVEFILE_WRITE_THROUGH` is not set: it would need `unsafe`, which `vaultair-core` forbids.
- **The automatic backup before a schema migration is not built.** Migrations run without one. It is needed once migrations ship to released vaults.
- **Transient files:** `vault.vhdr.tmp` during any header write, and `vault.vhdr.prev` during a password or KDF change.
- **The cloud-folder warning** also covers Box.
- **The CI check** blocks `*.vdb`, `*.vhdr`, `*.vhdr.*` and `*.vaultair-backup`, except the golden fixtures under `tests-fixtures/`.
