# ADR-0002: Cryptography and encrypted storage

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

The spec requires a vetted encryption approach, Argon2id for key derivation, encrypted metadata, working search, and durable incremental writes. Four options were compared in `docs/implementation-plan.md` §2.1:

- **A.** SQLCipher only (its PBKDF2 KDF)
- **B.** Plain SQLite + per-field AEAD
- **C.** In-memory SQLite, whole-file encrypted blob (KeePass model)
- **D.** SQLCipher with a raw key + Argon2id key hierarchy + field-level AEAD for the most sensitive fields

## Decision

**Option D.**

- **Database:** SQLCipher 4 via `rusqlite` with `bundled-sqlcipher-vendored-openssl`. The DB is opened with a raw 32-byte key (`PRAGMA key = "x'…'"`), so SQLCipher's own PBKDF2 is bypassed. Cipher settings are pinned explicitly in the vault header.
- **Key hierarchy:**
  - master password → NFC → **Argon2id** → KEK
  - KEK unwraps a random **DEK** (XChaCha20-Poly1305, header fields as AAD)
  - DEK → HKDF-SHA256 → `DB_KEY`, `FIELD_KEY`, `FP_KEY`, `BACKUP_KEY`
- **Field envelope:** passwords, TOTP secrets, backup codes, recovery instructions, sensitive notes and secret custom fields are stored as XChaCha20-Poly1305 blobs (AAD binds table, column and row id). They remain ciphertext inside the unlocked DB until an explicit reveal or copy.
- **KDF parameters:** calibrated on device to about 1 s, m ∈ [64, 512] MiB, t = 3, p = 4. Stored in the header; the reader enforces floors (m ≥ 64 MiB, t ≥ 3) and caps (m ≤ 2 GiB).
- **Crates:** `argon2`, `chacha20poly1305`, `hkdf`, `hmac`, `sha2`, `rand_core`/`getrandom`, `zeroize`, `secrecy`, `zxcvbn`, `unicode-normalization`, `totp-rs`.
- **Changing the master password** re-wraps the DEK only. "Rotate encryption key" (new DEK, full re-encrypt) is designed for but deferred past the MVP.

## Build verification

The Windows build risk (OpenSSL via `openssl-src` needs a native Perl) was de-risked in Phase 0 with a throwaway crate. See the Phase 0 notes in the README for the result.

## Fallback

If the SQLCipher/OpenSSL build becomes a blocker, fall back to **Option C** (pure Rust: in-memory SQLite, whole-file AEAD). This is a larger custom format surface and rewrites the file on each save, so it is a fallback only.

## Consequences

- Metadata, indexes, FTS shadow tables and journals are all encrypted at rest.
- The field layer keeps secrets out of the page cache, FTS, `SELECT *` results and DTOs.
- Old backups keep opening with the old password after a password change (same DEK). This must be documented to users.
- The build requires Strawberry Perl locally and in CI.

## As built (checked in Phase 16)

The decision stands. Where the code is more specific, or differs:

- **Subkeys:** five, not four. Phase 15b added `DEVICE_KEY` (HKDF info `vaultair/v1/quick-unlock-policy`), which keys the MAC on a quick-unlock slot's policy record (ADR-0005).
- **KDF calibration** aims for about 0.85 s (`CALIBRATE_TARGET`), with memory rounded down to a multiple of 8 MiB. The reader's bounds are 64 MiB ≤ m ≤ 2 GiB, 3 ≤ t ≤ 64 and 1 ≤ p ≤ 16.
- **Crates:** randomness comes from `getrandom` directly; `rand_core` is not a dependency. TOTP is Vaultair's own `crypto/totp.rs` (RFC 6238) on the RustCrypto HMAC and SHA crates; `totp-rs` is not used, because it would pull in older duplicates of them. `subtle` does the constant-time comparisons.
- **Backups** copy the database file under a read transaction. SQLite's online backup API, which the plan named, is refused by SQLCipher on encrypted databases (`docs/vault-format.md` §11).
