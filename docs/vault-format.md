# Vault format (v1)

> **Status:** Phase 3. Updated in Phase 14 (backup container, §11). Describes what `crates/vaultair-core` writes today. Password change (Phase 15) will extend this document. Rationale: `docs/adr/0002-crypto-and-storage.md`, `docs/adr/0003-vault-layout.md`.

This document is meant to be precise enough for an independent implementation to open a vault, given the master password.

## 1. Folder layout

A vault is a folder. Its name is the vault's display name (validated: 1–64 characters, letters, digits, space and `- _ . ( )`, no leading/trailing space or dot, not a Windows device name).

| File | Purpose |
|---|---|
| `vault.vhdr` | Header: everything needed before the database can be opened. No user data. |
| `vault.vdb` | SQLCipher 4 database. All user data. |
| `.lock` | Empty file. Vaultair holds an exclusive OS lock on it while the vault is unlocked. |
| `vault.vhdr.tmp` | Exists only for a moment during a header write. |
| `vault.vhdr.prev` | Reserved for password change (Phase 15). |

Default parent folder: `%LOCALAPPDATA%\Vaultair\Vaults`.

## 2. Header file (`vault.vhdr`)

All integers little-endian.

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic `VAULTAIR` (ASCII) |
| 8 | 2 | `format_version` (u16). Currently `1`. |
| 10 | 4 | `body_len` (u32). At most 65,536. |
| 14 | `body_len` | UTF-8 JSON body (below) |
| 14 + `body_len` | 4 | CRC-32 (IEEE, as `crc32fast`) of bytes `0 .. 14 + body_len` |

The file must be exactly `18 + body_len` bytes. The CRC only detects accidental damage; tampering is detected by the key wrap (§4).

### JSON body

Field order is significant (it's part of the AAD, §4). Unknown fields are rejected.

```json
{
  "vault_id": "01a0d1c1-ef46-7591-9eb2-a49c5eb5e9c8",
  "created_at": "2026-09-24T04:52:22.9825416Z",
  "format_version": 1,
  "min_reader_version": 1,
  "demo": false,
  "kdf": {
    "alg": "argon2id",
    "v": 19,
    "m_kib": 524288,
    "t": 3,
    "p": 4,
    "salt_b64": "<32 random bytes, standard base64 with padding>",
    "out_len": 32
  },
  "pw_normalization": "NFC",
  "key_slots": [
    {
      "kind": "password",
      "kdf_ref": "kdf",
      "wrap": {
        "alg": "xchacha20poly1305",
        "nonce_b64": "<24 bytes>",
        "ct_b64": "<48 bytes: 32-byte DEK + 16-byte tag>"
      }
    }
  ],
  "db": {
    "engine": "sqlcipher",
    "compat": 4,
    "page_size": 4096,
    "hmac": "HMAC_SHA512",
    "kdf": "PBKDF2_HMAC_SHA512",
    "plaintext_header_size": 0
  },
  "field_envelope_version": 1
}
```

### Reader rules

1. Wrong magic, wrong length, CRC mismatch, invalid JSON or unknown fields: **corrupted header**.
2. `format_version` (prefix) greater than the reader's supported version, or `min_reader_version` greater than it: **too new**.
3. Prefix and body `format_version` differ: **corrupted header**.
4. Structural checks: `alg`, `v`, `out_len`, `pw_normalization`, exactly one `password` slot, wrap `alg`, the exact `db` section above, `field_envelope_version` = 1, `vault_id` a UUID. Any mismatch: **corrupted header**.
5. KDF bounds, checked **before** running Argon2: `65536 ≤ m_kib ≤ 2097152`, `3 ≤ t ≤ 64`, `1 ≤ p ≤ 16`, `m_kib ≥ 8·p`. Outside: **corrupted header**. (A tampered header can't force a weak KDF or a huge allocation.)
6. Salt 32 bytes, nonce 24 bytes, ciphertext 48 bytes, else **corrupted header**.

## 3. Key derivation

1. Normalize the master password to Unicode **NFC**, encode as UTF-8.
2. `KEK = Argon2id(v=0x13, m=m_kib KiB, t, p, salt, output 32 bytes)` with no secret or associated data.

Parameters are calibrated per device at creation: one Argon2id run at 64 MiB / t=3 / p=4 is timed, memory is scaled linearly toward ~0.85 s, clamped to 64–512 MiB and rounded down to a multiple of 8 MiB. t=3, p=4 are fixed.

## 4. Key wrap (password slot)

`DEK = XChaCha20-Poly1305-Decrypt(key = KEK, nonce = wrap.nonce, ciphertext = wrap.ct, aad = AAD)`

`AAD = "vaultair-header-aad-v1\0" || JSON(header with every slot's wrap.nonce_b64 and wrap.ct_b64 set to "")`

`JSON(...)` is the compact serialization (no whitespace) with the field order shown in §2. Because every other header field is in the AAD, changing any of them (salt, KDF parameters, vault id, created_at, demo flag, db settings) makes decryption fail. A failure is reported as **wrong password or tampered header**; the two are deliberately indistinguishable.

The DEK is 32 random bytes from the OS RNG, generated once per vault.

## 5. Subkeys

`HKDF-SHA256(salt = none, ikm = DEK)`, 32 bytes each:

| Info string | Key | Use |
|---|---|---|
| `vaultair/v1/sqlcipher` | DB_KEY | SQLCipher raw key |
| `vaultair/v1/field` | FIELD_KEY | Field envelopes (§7) |
| `vaultair/v1/pwfp` | FP_KEY | `HMAC-SHA256(FP_KEY, NFC(password))` for reuse detection |
| `vaultair/v1/backup-mac` | BACKUP_KEY | Backup container MAC (§11) |

## 6. Database (`vault.vdb`)

SQLCipher 4. On every open, in this order:

```sql
PRAGMA cipher_log_level = NONE;
PRAGMA key = "x'<DB_KEY as 64 uppercase hex chars>'";   -- raw key: SQLCipher's own PBKDF2 is skipped
PRAGMA cipher_compatibility = 4;
PRAGMA cipher_page_size = 4096;
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
PRAGMA cipher_plaintext_header_size = 0;
PRAGMA cipher_memory_security = ON;
SELECT count(*) FROM sqlite_master;                      -- fails if the key is wrong
PRAGMA temp_store = MEMORY;
PRAGMA secure_delete = ON;
PRAGMA journal_mode = DELETE;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA trusted_schema = OFF;
PRAGMA cell_size_check = ON;
```

After opening, Vaultair runs `PRAGMA cipher_integrity_check` (must return no rows) and `PRAGMA quick_check` (must return `ok`); otherwise the database is reported **corrupted**. It then applies pending migrations and checks that `vault_meta.vault_id` equals the header's `vault_id`.

The first 16 bytes of `vault.vdb` are SQLCipher's per-database salt (used for its HMAC key derivation even with a raw key). Every page, including page 1, is encrypted with AES-256-CBC and authenticated with HMAC-SHA512.

**Schema:** `crates/vaultair-core/src/db/migrations/V1__init.sql`. `PRAGMA user_version` holds the schema version (currently 1). A database with a higher `user_version` than the reader knows is **too new**. Each migration runs in one transaction with its version bump.

## 7. Field envelopes

Columns ending in `_enc` hold a second encryption layer, so these values stay ciphertext even inside the unlocked database:

`blob = 0x01 || nonce (24 B) || XChaCha20-Poly1305(FIELD_KEY, nonce, plaintext, aad)`

`aad = "vaultair|v1|" || table || "|" || column || "|" || row_id` (UTF-8)

Binding table, column and row id means an envelope can't be moved to another cell. A blob shorter than 41 bytes or with a version byte other than `0x01` is rejected.

## 8. Write ordering

- **Create:** the database is built first (keyed, migrated, `vault_meta` inserted), and the header is written last via write-temp, `fsync`, rename. A crash part-way leaves a folder without a header ("not found"), never a header pointing at a half-built database. If creation fails, the folder is removed (it was verified new or empty first).
- **Header writes** always use the temp-file-and-rename pattern.

## 9. Error classification

| Condition | Result |
|---|---|
| Folder missing | Not found |
| `vault.vhdr` missing | Header missing |
| `vault.vdb` missing | Database missing |
| `.lock` held by another process/handle | In use |
| Rules 1, 3, 4, 5, 6 in §2 | Corrupted (header) |
| Rule 2 in §2, or schema too new | Too new |
| Key unwrap fails | Wrong password or tampered header |
| Key doesn't open the DB, integrity checks fail, or `vault_id` mismatch | Corrupted (database) |

## 10. Golden fixtures

`tests-fixtures/v1/Golden/` is a real v1 vault (password: `fixture-only password, not a secret`) opened by `golden_fixture_v1_still_opens` on every test run, so format or schema changes are always tested against an existing vault. Until the first public release, V1 may still change and the fixture is regenerated; after it, fixtures are append-only.

## 11. Backup container (`*.vaultair-backup`)

One file holding a vault's header and database. User guide: [`backup-restore.md`](backup-restore.md). Code: `crates/vaultair-core/src/backup/`.

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic: ASCII `VAIRBKUP` |
| 8 | 2 | Container version, u16 LE. Currently `1` |
| 10 | 2 + n | `created_at`: u16 LE length, then UTF-8 RFC 3339 UTC. At most 64 bytes |
| … | 2 + n | `vault_id`: u16 LE length, then UTF-8. At most 64 bytes |
| … | 4 + n | Header: u32 LE length, then a complete `vault.vhdr` (§2). At most 128 KiB |
| … | 8 + n | Database: u64 LE length, then a complete `vault.vdb` (§6) |
| end − 32 | 32 | `HMAC-SHA256(BACKUP_KEY, every byte before it)` |

The lengths must add up to the file size exactly: no trailing bytes.

**Nothing in the file is plaintext vault data.** The header has no user data, and the database bytes are the SQLCipher file as it is on disk. `created_at` and `vault_id` are readable without a password and are not trusted until the MAC has been checked.

**Reading a backup, in this order:**

1. Check the magic and the version. A version above `1` is **too new**.
2. Read the fields with the caps above. Decode the header by the rules in §2. Its `vault_id` must equal the container's.
3. Get the DEK: from the password, through the header's key wrap (§3, §4), or already in hand for a backup of the open vault. A failed unwrap is **wrong password or tampered header**.
4. Derive BACKUP_KEY (§5) and check the MAC over the whole file, in constant time, while copying the database bytes out.
5. Open the copy with DB_KEY. Run `PRAGMA cipher_integrity_check` and `PRAGMA quick_check`. `PRAGMA user_version` above what the reader knows is **too new**. `vault_meta.vault_id` must equal the header's.

Anything else that fails in steps 1, 2, 4 or 5 is an **invalid backup**.

**Writing a backup.** The database bytes are read from `vault.vdb` under a SQLite read transaction, with the vault held so no write of ours is in flight. With `journal_mode = DELETE`, the file alone is then the whole database. SQLCipher refuses SQLite's online backup API on encrypted databases, and `sqlcipher_export` would rewrite every page; a byte copy keeps the pages and their HMACs exactly as they are. The header bytes are read from `vault.vhdr`. The container is written to `<name>.vaultair-backup.tmp`, flushed and renamed. Vaultair then reads it back (steps 1 to 5) before reporting success.

**Password change.** A backup carries the header it was made with, so it opens with the master password of that time. The DEK does not change on a password change, so BACKUP_KEY stays the same and older backups of the same vault still pass step 4 with the open vault's key.

**Restore** writes the database first and the header last, into a folder that must be new or empty, like create (§8). The restored vault takes its folder's name: `vault_meta.display_name` is updated if it differs.
