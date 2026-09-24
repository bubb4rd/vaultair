# Vaultair threat model

> **Status: Phase 0 draft.** Written from the product spec before any code exists. Updated in Phase 3 (crypto), Phase 5 (OS integrations and clipboard) and finalised in Phase 16. Statements about mechanisms describe the *design*; each is verified by tests as it's built.

## What Vaultair is

A local-first Windows app that stores account, identity and recovery information for people with many gaming and online accounts, in an encrypted vault on their own disk. There is no Vaultair account, no server, and the MVP makes no network connections.

## Assets

| Asset | Sensitivity |
|---|---|
| Account passwords, TOTP secrets, backup/recovery codes, recovery instructions, sensitive notes | Critical |
| Master password and derived keys | Critical |
| Account metadata: usernames, emails, which platforms and games, purposes, relationships between identities | High (it maps a person's whole online footprint) |
| Encrypted backups | High (offline-attackable if the master password is weak) |
| App configuration (recent vault paths, UI preferences) | Low; contains no vault data |

## Trust boundaries

1. **Disk ↔ app.** Everything on disk is encrypted except the vault header (KDF parameters, salt, wrapped key; no user data) and the app config.
2. **Rust core ↔ WebView UI.** The UI is treated as semi-untrusted. Secrets stay in Rust except when the user explicitly reveals one. Copy goes straight from Rust to the clipboard.
3. **App ↔ Windows.** Clipboard, screen capture and session-lock integrations depend on OS behaviour that Vaultair doesn't control.

## Vaultair protects against

These come from the product spec and are the claims the app is built to back up:

- **Loss of account organization:** structured identities, purposes, games/platforms, relationships and search.
- **Reused passwords:** duplicate detection via keyed fingerprints (HMAC), without exposing values.
- **Forgotten recovery-code locations:** recovery codes and instructions tracked per account, with health checks for missing ones.
- **Confusion across game identities:** the identity model and relationship map.
- **Casual local access while the vault is locked:** the vault can't be read without the master password. Argon2id makes guessing slow. Locking wipes keys from memory and reloads the UI.
- **Unencrypted local data exposure from normal app usage:** the whole database (including metadata, indexes and search tables) is encrypted with SQLCipher; the most sensitive fields get a second encryption layer; no browser storage, no temp files, no plaintext logs of secrets.
- **Accidental clipboard exposure:** copies auto-clear (default 30 s) and are marked to be excluded from Windows clipboard history and cloud clipboard.
- **Lack of account recovery preparedness:** health checks for missing MFA and missing recovery codes, plus backup reminders.
- **Walk-up access to an unlocked session:** auto-lock after inactivity, on Windows session lock, and on sleep.
- **Being seen while streaming or screen-sharing:** screen-capture protection (on by default) hides the window from most capture tools.
- **Header tampering and KDF downgrade:** the header is authenticated, and minimum KDF parameters are enforced.

## Vaultair does NOT protect against

Stated plainly, as the spec requires:

- **Malware controlling an unlocked computer.** Code running as you can read the app's memory, drive the UI, or read the clipboard while the vault is unlocked.
- **Keyloggers.** They can capture the master password as it's typed.
- **Screen-capture malware.** Capture protection stops ordinary capture tools, not a determined attacker or a compromised OS.
- **Compromised operating systems**, drivers or firmware.
- **A user revealing their master password** to anyone, including through phishing.
- **A lost master password with no backup or recovery material.** There is no recovery, reset, back door or hint. The data is unrecoverable by design.
- **Platform-level bans, account restrictions or game enforcement actions.** Vaultair organizes accounts; it doesn't change how platforms treat them.

## Known limits (honest caveats)

- **Memory hygiene is best-effort.** Keys and decrypted values are zeroized in Rust, but copies made by memory reallocation, WebView2 IPC buffers, JavaScript strings, SQLite internals and clipboard memory can't all be wiped.
- **Revealed secrets exist in the UI** until auto-hidden (default 20 s) or the vault locks.
- **Third-party clipboard managers** may ignore the "don't record" markers. A crash before the clipboard clears leaves the value there.
- **Weak master passwords weaken everything,** especially stolen backups, which can be attacked offline. The app enforces a minimum (12+ characters, strong zxcvbn score).
- **Old backups keep working with the old master password** after a password change, because the underlying data key is unchanged. A future "Rotate encryption key" action addresses this.
- **Metadata inside the encrypted DB** includes password strength scores and keyed fingerprints. These are encrypted at rest but visible to anything that can read the unlocked DB.
- **WebView2** is a Microsoft component with its own update and telemetry behaviour, governed by Windows settings.
- **Cloud-synced folders:** if the user places a vault or backup in OneDrive/Dropbox, the (encrypted) files leave the machine. The app warns but doesn't block.

## Out of scope for the MVP

Sync, browser extension, autofill, breach checks, imports, attachments, Windows Hello unlock. Each needs a threat-model update before it's built (see the future `future-extension-sync-checklist.md`).

## Explicit non-goals

Vaultair will never implement game cheats, memory reading, anti-cheat bypasses, credential harvesting or stuffing, automated or scripted logins, ban-evasion tools, account selling/transfer, account marketplace integrations, a mandatory cloud account, or tracking/analytics that expose account metadata.
