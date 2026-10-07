# Security assumptions

> **Status:** Phase 3 first version. Updated in Phase 5 (OS integrations, clipboard), Phase 7 (accounts) and Phase 15b (Windows Hello unlock). The threat model (`docs/threat-model.md`) says what Vaultair defends against; this document lists what that defense *relies on* and where its limits are.

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
6. **Windows Hello keeps its keys and asks before using them** (only with Windows Hello unlock on). The key can't be exported, every signature needs the user's approval in a prompt Windows draws, and the same challenge always gives the same signature (RSA PKCS#1 v1.5, checked in `docs/spikes/hello-quick-unlock.md` within a process, across processes, after a restart and after a PIN change).
7. **DPAPI is tied to the Windows account**, and is trusted for nothing more: any process running as the user can undo it without a prompt. It is an outer layer on the slot, not what protects the data key.

## Known limits

- **Memory hygiene is best-effort.** Keys (`VaultKeys`, `Dek`, the KEK) and decrypted field values are wiped on drop. But copies can survive in places we don't control: Rust moves and reallocations, the SQLite page cache and SQLCipher internals (mitigated by `cipher_memory_security = ON`), the SQLCipher key literal passed through `PRAGMA key`, the IPC buffers that carry a typed password from the webview, JavaScript strings in the webview, and clipboard memory (Windows keeps copied text in a global memory block Vaultair can't wipe; clearing empties the clipboard but the freed memory isn't zeroed).
- **Passwords cross the IPC boundary as JSON strings.** `vault_create` and `vault_unlock` receive the master password from the UI. Rust moves it into a `SecretString` immediately, but the webview and the deserializer may keep copies until their memory is reused.
- **Metadata inside the encrypted database** includes password strength scores and keyed fingerprints (Phase 7). Both are encrypted at rest but readable by anything that can read the unlocked database. Fingerprints are HMACs under a vault-specific key, so they reveal nothing outside the vault; inside it they reveal which accounts share a password (which is the point of the feature).
- **Old headers and backups keep working with the old password** after a password change, because the DEK doesn't change (re-wrap only). "Rotate encryption key" is designed for but not in the MVP.
- **The CRC in the header is not a security check.** Tampering is caught by the authenticated key wrap.
- **The header reveals** that a file is a Vaultair vault, its creation time, its KDF parameters and whether it's a demo vault. It reveals nothing about contents.
- **Wrong password and tampered header are indistinguishable** by design: both are an authentication failure of the key wrap.
- **`.lock` is advisory within Vaultair.** It stops a second Vaultair instance from opening the same vault. It doesn't stop other programs from copying the (encrypted) files.
- **Timing:** a wrong password costs a full Argon2 run, like a right one. All checks before Argon2 depend only on the files, not on the password.

- **Clipboard history exclusion relies on other apps honouring it.** Windows clipboard history and cloud clipboard respect `CanIncludeInClipboardHistory` and `CanUploadToCloudClipboard`; third-party clipboard managers may ignore `ExcludeClipboardContentFromMonitorProcessing`. Any app running as you can read the clipboard while a value is on it.
- **A crash before the clear leaves the value on the clipboard.** Timed clears, "Clear now", lock and a normal exit all clear; a crash or a killed process doesn't. "Keep in clipboard" is the user opting out of the clear.
- **Idle lock can come up to 15 s early**, because activity pings are throttled. The deadline itself is in Rust, so a stalled or compromised UI can't extend it without sending pings.
- **Capture protection stops capture APIs, not people.** It hides the window from screenshot tools, screen sharing, streaming and Recall snapshots. It doesn't stop a camera, or code running with your rights that reads the window's memory. Before Windows 10 2004, captures show a black box instead of nothing.

- **Windows Hello unlock keeps a wrapped copy of the DEK on this PC.** Opening it takes a Hello approval; see the threat model for what that does and doesn't stop. Its rules (restart, 7 days, 3 failed attempts) are enforced by Vaultair, not by the key, and the failure count in the slot has no MAC, because nothing can be authenticated before the DEK is known. Editing the count buys more Hello prompts, never an unlock.
- **The Hello signature is key material while it is in memory.** Rust's copy is wiped after the HKDF; the WinRT buffer it arrived in can't be.
- **Restart detection is the uptime** (`GetTickCount64`), read as now minus uptime and compared within 2 minutes. Fast Startup keeps the uptime across "Shut down", and moving the system clock by more than 2 minutes reads as a restart (the safe direction).
- **TPM detection asks the TPM service** (`Tbsi_GetDeviceInfo`). Hello's own attestation reports `NotSupported` on working firmware TPMs, so it isn't used. A PC with a TPM that Hello doesn't use for some reason would not get the "no TPM" warning.

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
- Idle lock fires exactly at the deadline, `touch` extends it, it can be turned off, and a locked session refuses data commands (`ManualClock`).

Phase 5 tests elsewhere:
- `src-tauri/src/clipboard.rs` (paused tokio clock, fake clipboard): clears after the timeout, "Keep" cancels, a later user copy is never cleared, "Clear now", a new copy restarts the timer, a busy clipboard fails cleanly.
- `src-tauri/src/lock.rs`: the ADR-0004 lock policy; a fake session-lock event locks the vault and clears the clipboard; idle and manual locks take the same path.
- `crates/vaultair-platform/src/windows/clipboard.rs` (ignored, real clipboard): the three exclusion formats are present; only our write is cleared; clearing works after the owner window is destroyed (exit).

Phase 15b tests:
- `crates/vaultair-core/src/vault/device_slot.rs`: round trip; a different signature, vault id or header is rejected; every single changed byte is caught, and edits that keep the CRC valid still fail the unwrap; a forged policy record, or one MACed with another vault's key, is refused; the data key and the signature never appear in the slot or its `Debug` output.
- `crates/vaultair-core/src/service/quick_unlock.rs` (in-memory Hello, DPAPI and uptime; `ManualClock`): unlock after one password unlock; the restart, 7-day and 3-failure rules, each without showing a Hello prompt once it applies, and each cleared by a password unlock; a changed password voids the slot, including one edited to claim the new header; a forged policy record gets past the hint and is refused after the unwrap; a damaged slot, another vault's slot and a missing Hello key all fall back to the password; turning it on or off needs the right password; a cancelled enrollment leaves no slot and no key; the data key is in neither the stored nor the unwrapped slot bytes.
- `src-tauri/src/quick_unlock.rs`: the same service through the platform crate's `FakeHello`.
- `crates/vaultair-platform/src/windows/dpapi.rs`: a real DPAPI round trip, bound to its entropy, refusing changed bytes. `hello.rs` has a real-Hello determinism test, ignored because it needs someone to approve the prompts (`cargo test -p vaultair-platform -- --ignored real_hello`).
- `src/features/lock/LockScreen.test.tsx`, `src/features/settings/quickUnlock.test.tsx`: the lock screen falls back to the password on cancel and shows only the password when a rule requires it; Settings turns it on and off with the password and warns when there is no TPM.
- `src/features/shell/HelloOffer.test.tsx`, and the `enable_after_password` tests in `service/quick_unlock.rs`: the offer turns it on with one Hello prompt only while the master password is fresh (5 minutes), never in a session Hello opened or a locked one, and falls back to the password dialog otherwise.
- **Hello offer, running app (owner, 2026-10-07, after [PR #23](https://github.com/bubb4rd/vaultair/pull/23)):** the corner card after a master-password unlock; **Turn on** with one Hello prompt while the password is fresh; **Not now** and **Don't ask again**; password dialog when stale or after a Hello unlock; no offer on the demo vault.
