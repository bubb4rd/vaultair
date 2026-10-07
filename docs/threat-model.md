# Vaultair threat model

> **Status: Phase 0 draft.** Written from the product spec before any code exists. Updated in Phase 3 (crypto), Phase 5 (OS integrations and clipboard) and Phase 15b (Windows Hello unlock), and finalised in Phase 16. Statements about mechanisms describe the *design*; each is verified by tests as it's built.

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

## Windows Hello unlock (optional, off by default)

Decided in [ADR-0005](adr/0005-quick-unlock.md); format in `docs/vault-format.md` §12. When it is on for a vault, a copy of the vault's data key sits on this PC, wrapped under a key that can only be rebuilt from a Windows Hello signature. The master password stays the root of trust: it alone creates, restores and re-keys a vault, and it is needed to turn this on or off. One exception: for 5 minutes after the master password opens a vault, Hello unlock can be turned on without typing it again (that is the offer Vaultair shows after unlocking).

What it changes, against each attacker:

| Attacker | With Windows Hello unlock on |
|---|---|
| Has a copy of the vault files or a backup | **Nothing changes.** The slot is not in the vault folder or in backups. Without it, and without this PC's Hello key, only the master password opens the vault |
| Has the vault files **and** the slot file, but not this PC | **Nothing changes.** The slot needs a signature from a key that never leaves this PC's Windows Hello (and its DPAPI layer needs this Windows account) |
| Malware running as you, vault locked | Can't open the slot silently: Windows must show a Hello prompt and you must approve it. It can raise that prompt at any time and hope you approve, so **treat a Hello prompt you didn't ask for as an attack and cancel it**. Without Hello unlock, the same malware would have to wait for you to type the master password |
| Someone at your unlocked Windows session who knows or guesses your Hello PIN | Can unlock the vault, within the rules below. Without Hello unlock they would need the master password. **A short Hello PIN is now part of your vault's protection** |
| Has the powered-off or restarted PC (stolen laptop) | Vaultair asks for the master password after a restart. An attacker running their own code is not bound by that rule (see the limits): what stands between them and the data key is the Windows sign-in, the Hello PIN and the TPM's guess limit |

The rules Vaultair applies: the master password is asked for after Windows restarts, more than 7 days after it was last typed, after 3 failed or cancelled Hello attempts in a row, and after the password or KDF changes. Turning auto-lock off also takes it. Idle lock, Win+L and sleep still wipe the keys from memory exactly as before; only the next unlock is quicker.

Limits, stated plainly:

- **The restart, 7-day and 3-attempt rules are enforced by Vaultair, not by the key.** They stop someone using Vaultair. Code that reads the slot and gets a Hello approval can unwrap the data key whatever the rules say. The rules can't be faked into letting Vaultair itself skip the password: the record of the last password unlock carries a MAC made with the vault's own key, and a forged one is refused.
- **Windows Hello is only as strong as its weakest sign-in option.** A 4-digit PIN on a PC with a TPM is protected by the TPM's lockout. On a PC with no TPM the Hello key is protected by software only; Vaultair says so before you turn this on, and allows it.
- **For 5 minutes after you type the master password, turning this on takes only a Hello approval.** Someone who reaches your unlocked vault in that time and knows your Hello PIN can turn it on, and then unlock with that PIN until Windows restarts or 7 days pass. After the 5 minutes, or in a session Hello opened, they would need the master password. Settings > Security shows whether it is on, and "Forget this device" turns it off.
- **Restart detection uses the uptime.** With Windows Fast Startup, "Shut down" does not reset it, so only "Restart" (or a full shutdown) brings the password back early. The 7-day rule still applies.
- **Turning it off deletes the Hello key**, which makes any copy of the slot useless. If that deletion fails, an old copy of the slot plus a Hello approval on this PC would still open the data key, because the data key does not change on a password change. "Rotate encryption key" (not in the MVP) is the full answer.
- **A restored copy of a vault** has the same vault id. If it also has the same master password and KDF, the slot opens it too. It is the same vault on the same PC.
- **Windows' signature scheme.** The design relies on Hello signing the same challenge the same way every time (checked on real hardware in the spike). If Windows ever changes that, the slot stops opening, Vaultair falls back to the master password, and the slot is made again.

**Tray.** "Keep running in the tray" only changes what closing the window does: the window hides, the vault locks as it did on quit, and the process stays to skip startup. No key stays in memory because of it.

## Out of scope for the MVP

Sync, browser extension, autofill, breach checks, imports and attachments. Each needs a threat-model update before it's built (see the future `future-extension-sync-checklist.md`).

## Explicit non-goals

Vaultair will never implement game cheats, memory reading, anti-cheat bypasses, credential harvesting or stuffing, automated or scripted logins, ban-evasion tools, account selling/transfer, account marketplace integrations, a mandatory cloud account, or tracking/analytics that expose account metadata.
