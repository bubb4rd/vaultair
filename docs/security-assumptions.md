# Security assumptions

> **Status:** Phase 3 first version. Updated in Phase 5 (OS integrations, clipboard) and Phase 7 (accounts). The threat model (`docs/threat-model.md`) says what Vaultair defends against; this document lists what that defense *relies on* and where its limits are.

## Libraries we trust

| Component | Used for | Why it's trusted |
|---|---|---|
| RustCrypto `argon2` 0.6 | Master password KDF | Widely used, pure Rust, zeroizes its memory (`zeroize` feature enabled) |
| RustCrypto `chacha20poly1305` 0.11 | Key wrap, field envelopes | Widely used AEAD implementation |
| RustCrypto `hkdf`, `hmac`, `sha2` | Subkeys, fingerprints | Standard constructions |
| `getrandom` | All randomness | Calls the OS CSPRNG (`BCryptGenRandom` on Windows) |
| SQLCipher 4.6 (bundled by `rusqlite`) + OpenSSL 3 (vendored) | Whole-database encryption | Mature, widely deployed; settings pinned in the header |
| `zxcvbn` | Master password strength | Port of Dropbox's estimator |

Versions are pinned in `Cargo.lock`; `cargo deny` checks advisories, licenses and sources in CI.

## Assumptions

1. **The OS RNG is sound.** Salt, DEK and every nonce come from it.
2. **Random 24-byte nonces don't collide.** XChaCha20's 192-bit nonce makes this negligible at any realistic number of writes.
3. **Argon2id at ≥ 64 MiB, t=3 makes offline guessing expensive.** It doesn't make a weak password strong, which is why the policy requires 12+ characters and a zxcvbn score of 3+.
4. **The machine isn't compromised while the vault is unlocked.** See the threat model.
5. **NTFS rename is atomic.** Header writes rely on write-temp, `fsync`, rename (`MoveFileExW` with replace).

## Known limits

- **Memory hygiene is best-effort.** Keys (`VaultKeys`, `Dek`, the KEK) and decrypted field values are wiped on drop. But copies can survive in places we don't control: Rust moves and reallocations, the SQLite page cache and SQLCipher internals (mitigated by `cipher_memory_security = ON`), the SQLCipher key literal passed through `PRAGMA key`, the IPC buffers that carry a typed password from the webview, JavaScript strings in the webview, and (later) clipboard memory.
- **Passwords cross the IPC boundary as JSON strings.** `vault_create` and `vault_unlock` receive the master password from the UI. Rust moves it into a `SecretString` immediately, but the webview and the deserializer may keep copies until their memory is reused.
- **Metadata inside the encrypted database** includes password strength scores and keyed fingerprints (Phase 7). Both are encrypted at rest but readable by anything that can read the unlocked database. Fingerprints are HMACs under a vault-specific key, so they reveal nothing outside the vault; inside it they reveal which accounts share a password (which is the point of the feature).
- **Old headers and backups keep working with the old password** after a password change, because the DEK doesn't change (re-wrap only). "Rotate encryption key" is designed for but not in the MVP.
- **The CRC in the header is not a security check.** Tampering is caught by the authenticated key wrap.
- **The header reveals** that a file is a Vaultair vault, its creation time, its KDF parameters and whether it's a demo vault. It reveals nothing about contents.
- **Wrong password and tampered header are indistinguishable** by design: both are an authentication failure of the key wrap.
- **`.lock` is advisory within Vaultair.** It stops a second Vaultair instance from opening the same vault. It doesn't stop other programs from copying the (encrypted) files.
- **Timing:** a wrong password costs a full Argon2 run, like a right one. All checks before Argon2 depend only on the files, not on the password.

## Verified by tests

`crates/vaultair-core/tests/vault_integration.rs` covers:
- Round trip across lock/unlock.
- A wrong password runs Argon2 before failing.
- Every authenticated header field (salt, m, t, p, vault id, created-at, demo, nonce, ciphertext) is tamper-evident. A mutation test confirmed the suite fails if the AAD binding is removed.
- KDF floor and cap.
- Damaged headers; newer formats and schemas.
- Flipped database bytes; a database swapped in from another vault.
- Missing files; single-open.
- Canary scan: no plaintext in any vault file, and no secret in a plaintext SQL export (the field layer holds).
- The golden v1 fixture still opens.
