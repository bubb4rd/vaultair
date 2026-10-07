# Vaultair threat model

> **Status:** reviewed against the implementation in Phase 16 (2026-10-06), before the first installer. First written from the product spec in Phase 0, and updated in Phase 3 (crypto), Phase 5 (OS integrations and clipboard) and Phase 15b (Windows Hello unlock). Every statement about a mechanism describes what the code does now; the tests behind them are listed in `docs/security-assumptions.md`.

## What Vaultair is

A local-first Windows app that stores account, identity and recovery information for people with many gaming and online accounts, in an encrypted vault on their own disk. There is no Vaultair account and no server, and the app makes no network connections: it contains no network client (`deny.toml` fails the build if one is added) and its window may only load its own bundled pages.

One thing outside the app touches the network at your request: "Open in browser" hands a stored web address to your default browser.

Installing is configured not to. `tauri.conf.json` sets `webviewInstallMode` to `offlineInstaller`, which puts Microsoft's full WebView2 runtime installer inside Vaultair's installer (making it roughly 130 MB larger), so a PC without WebView2 gets it with no download; `scripts/check-release-config.mjs` fails CI if that setting is changed. No installer has been built yet, so this describes the configuration, not an install that was observed. Two things stay true and are not Vaultair's doing: Tauri's bundler downloads that runtime installer from Microsoft on the build machine when the installer is built, and once WebView2 is on a PC it keeps itself up to date through Microsoft's own updater, as it does for every app that uses it. That is how WebView2 gets its security fixes, which is why a frozen copy of the runtime was not chosen.

## Assets

| Asset | Sensitivity |
|---|---|
| Account passwords, TOTP secrets, backup/recovery codes, recovery instructions, sensitive notes | Critical |
| Master password and derived keys | Critical |
| Account metadata: usernames, emails, which platforms and games, purposes, relationships between identities | High (it maps a person's whole online footprint) |
| Encrypted backups | High (offline-attackable if the master password is weak). The file's name is not encrypted: it is the vault's name and the date |
| Windows Hello slot (only while Hello unlock is on for a vault) | High: the vault's data key, wrapped. Useless without a Windows Hello approval on this PC |
| App configuration (recent vault paths, UI preferences) | Low; contains no vault data. A vault's folder is named after the vault when it is created, so the paths show that name |
| Diagnostic logs | Low. No names, usernames, emails, web addresses, values, or paths to files on your PC. They do show when a vault was opened and locked, and when a secret was shown or copied (see the limits) |

## Trust boundaries

1. **Disk ↔ app.** Everything a vault holds is encrypted on disk. What is written unencrypted: the vault header (KDF parameters, salt, wrapped key; no user data), the app config, the diagnostic logs, WebView2's own profile folder (the browser engine's cache; Vaultair puts nothing in web storage), and the names of files and folders. A vault's folder is named after it, and each backup is called `<vault name>-YYYYMMDD-HHMMSS.vaultair-backup`, so the vault's name and when it was backed up can be read wherever backups are kept, including a cloud-synced folder.
2. **Rust core ↔ WebView UI.** The UI is treated as semi-untrusted. A stored secret reaches it only when you ask for it:
   - **Show** on a password, a hidden custom field, an MFA setup key, recovery steps, a backup code or the sensitive notes returns that one value (`secret_reveal`);
   - **Show code** returns the current TOTP code, and a new one each time it changes while it stays shown (`totp_current_code`);
   - **Edit** on sensitive notes or on an MFA method's recovery steps loads the saved text into the form, because it can't be edited unseen.

   The Copy button never passes the value through the UI: Rust decrypts it and writes the clipboard itself. A secret shown on screen is not selectable text: the app turns text selection off everywhere except in fields you type in and a few paths, so it is not meant to be copied by hand at all. A second layer stands behind that, and what is and isn't verified about both is under the limits. Everything else the UI receives carries flags (`hasPassword`, a strength score, how many backup codes are left), never values.

   Two more kinds of secret are in the UI by nature: whatever you type (the master password, a new or changed secret), and a password the generator has just made, which is shown as soon as it is generated and, if you copy it before saving, goes back to Rust to be put on the clipboard.
3. **App ↔ Windows.** Clipboard, screen capture and session-lock integrations depend on OS behaviour that Vaultair doesn't control.

## Vaultair protects against

These come from the product spec and are the claims the app is built to back up:

- **Loss of account organization:** structured identities, purposes, games/platforms, relationships and search.
- **Reused passwords:** duplicate detection via keyed fingerprints (HMAC), without exposing values.
- **Forgotten recovery-code locations:** recovery codes and instructions tracked per account, with health checks for missing ones.
- **Confusion across game identities:** the identity model and relationship map.
- **Casual local access while the vault is locked:** the vault can't be read without the master password. Argon2id makes guessing slow. Locking wipes keys from memory and reloads the UI.
- **Unencrypted local data exposure from normal app usage:** the whole database (including metadata, indexes and search tables) is encrypted with SQLCipher. Passwords, TOTP setup keys, backup codes, recovery steps, sensitive notes and hidden custom fields get a second encryption layer and stay ciphertext inside the open database until one is shown or copied. Nothing from a vault is written in plaintext anywhere else: no browser storage, no plaintext temporary files (the working files that do exist are listed under the limits, and are encrypted), and no secret, name, username or email in the logs.
- **Accidental clipboard exposure:** copies auto-clear (default 30 s; 10 s to 5 minutes) and are marked to be excluded from Windows clipboard history and cloud clipboard. Locking and quitting clear a copy that is still pending.
- **Lack of account recovery preparedness:** health checks for missing MFA and missing recovery codes, plus backup reminders.
- **Walk-up access to an unlocked session:** by default the vault locks after 5 minutes without activity, when Windows locks, signs out or disconnects, and on sleep. Each of these is a setting and can be turned off; shutting down and quitting always lock.
- **Being seen while streaming or screen-sharing:** screen-capture protection hides the window from most capture tools. It is on by default, for every screen including the lock screen. It can be turned off, or set to hide the window only while a lower-rated account is open; in that mode every other screen can be captured.
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
- **Revealed secrets exist in the UI** until they hide themselves (default 20 s; 5 s to 5 minutes), you hide them, you leave the page, or the vault locks, which reloads the UI. Three things have no timer: text opened for editing (sensitive notes, recovery steps), a secret you are typing, and a password on the generator. They stay until you save, cancel or leave that screen, or the vault locks.
- **Not everything in a vault has the second encryption layer.** Names, usernames, emails, recovery emails and phone references, web addresses, player IDs, tags, plain notes (on accounts, identities, MFA methods and game profiles) and custom fields that aren't hidden are protected by the database encryption only. They are listed, searchable, and readable by anything that can read the unlocked database. What must stay hidden belongs in the password, the sensitive notes or a hidden field.
- **The wait after wrong passwords is cosmetic.** After 5 wrong master passwords the lock screen makes you wait (5, 10, 20, 40, then 60 s). The count lives in the lock screen only: Rust keeps none, and restarting Vaultair resets it. It slows someone guessing at the keyboard. What limits guessing, there and against a stolen copy of the files, is Argon2's cost per attempt.
- **Idle lock is timed from activity as Rust hears of it.** The UI reports pointer and keyboard activity at most once every 15 s, so the vault can lock up to 15 s later than the setting says after your last movement. It does not lock early: activity inside a 15 s window is reported when the window ends, long before the shortest timeout (1 minute). A UI that stops reporting altogether locks on time, counted from its last report. Reading without touching the mouse or keyboard counts as idle.
- **Copying a shown secret by hand.** In order of how sure this is:
  1. *A shown secret is not selectable.* The stylesheet sets `user-select: none` on the whole page and turns selection back on only for inputs, text areas and elements marked `select-text` (folder paths). The shown password, hidden field, setup key, recovery steps, sensitive notes, backup code, TOTP code and generated password are none of those. This is read from the code (`src/styles/globals.css`); no automated test covers it, because the test DOM ignores CSS.
  2. *If a copy, cut or drag whose selection touches a shown secret happens anyway,* Vaultair stops the webview's own copy. When the selection lies inside that one value, the whole value is copied through Rust like the Copy button (kept out of clipboard history and the cloud clipboard, cleared on the timer); when it runs past the value, nothing is copied and a notice says so. Dragging it is stopped.
  3. *That second layer has only been exercised in the test DOM,* not in a real WebView2 window. Whether a selection can reach a shown secret there at all (double or triple click, Ctrl+A), and what Ctrl+C then puts in Win+V, is a manual check that has not been done.

  None of this covers a field you can type in: a secret you are typing with its eye icon on, or sensitive notes or recovery steps opened for editing. Those are selectable, and copying from them is an ordinary Windows copy, which goes into clipboard history (Win+V) and the cloud clipboard if you use them and is never cleared by Vaultair. Nor can Vaultair stop another program, a screen reader or a person from reading what is on screen.
- **Third-party clipboard managers** may ignore the "don't record" markers. A crash before the clipboard clears leaves the value there. **Keep in clipboard** turns the clear off for that copy: the value then stays until you copy something else, through a lock and through quitting.
- **The logs record activity.** They are plain text in `%LOCALAPPDATA%\Vaultair\logs`, kept for 7 days. They never hold a secret, a name, a username, an email, a web address, or a path to a file or folder on your PC. A crash is logged by where in the program's source code it happened, never by its message. They do hold the random ids of records that were created or changed, and a line each time a vault is opened or locked and each time a secret is shown or copied, with its kind ("account password", "totp code") but not which account. Someone who can read your Windows profile can tell when you used Vaultair and roughly what you did. When the Tauri runtime itself fails (to start, to create the tray icon, to reach the window), the log gets the kind of error and none of its text, because that text isn't Vaultair's and could quote a path.
- **Working files are encrypted, not absent.** While a backup is checked, a copy of its database (still SQLCipher-encrypted) sits in `%LOCALAPPDATA%\Vaultair\tmp`. A backup, a vault header and a Windows Hello slot are each written to a `.tmp` file first. SQLite keeps a rollback journal beside `vault.vdb` during a write; SQLCipher encrypts its pages as it does the database's (a property of SQLCipher that Vaultair's own tests don't check). A crash can leave one of these behind. None holds vault data in plaintext. The full list is in `docs/local-data-storage.md`.
- **Weak master passwords weaken everything,** especially stolen backups, which can be attacked offline. The app enforces a minimum (12+ characters, strong zxcvbn score).
- **Old backups keep working with the old master password** after a password change, because the underlying data key is unchanged. A future "Rotate encryption key" action addresses this.
- **Metadata inside the encrypted DB** includes password strength scores, keyed fingerprints, how many backup codes are left, when each password was last changed and last shown or copied, and four yes/no flags per account saying whether its sensitive notes look like they hold identifiers, credentials, backup codes or security answers (the flags only, never the text; ADR-0006). These are encrypted at rest but visible to anything that can read the unlocked DB.
- **WebView2** is a Microsoft component with its own update and telemetry behaviour, governed by Windows settings. Its profile folder (`%LOCALAPPDATA%\app.vaultair.desktop\EBWebView`) is the browser engine's own cache and state, which Vaultair doesn't encrypt. Vaultair keeps nothing in web storage, and the addresses of its own pages contain only random record ids.
- **Cloud-synced folders:** if the user places a vault or backup in OneDrive/Dropbox, the (encrypted) files leave the machine. The app warns but doesn't block.

## Windows Hello unlock (optional, off by default)

Decided in [ADR-0005](adr/0005-quick-unlock.md); format in `docs/vault-format.md` §12. When it is on for a vault, a copy of the vault's data key sits on this PC, wrapped under a key that can only be rebuilt from a Windows Hello signature. The master password stays the root of trust: it alone creates, restores and re-keys a vault, and it is needed to turn this on or off. One exception: for 5 minutes after the master password opens a vault, Hello unlock can be turned on without typing it again (that is the offer Vaultair shows after unlocking; shipped [PR #23](https://github.com/bubb4rd/vaultair/pull/23), verified in the running app 2026-10-07).

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
- **For 5 minutes after you type the master password, turning this on takes only a Hello approval.** Someone who reaches your unlocked vault in that time and knows your Hello PIN can turn it on, and then unlock with that PIN until Windows restarts or 7 days pass. After the 5 minutes, or in a session Hello opened, they would need the master password. The 5 minutes are checked when **Turn on** is clicked, before the Hello prompt opens; Vaultair doesn't time out a prompt that is left open, though nothing is turned on if the vault has locked by the time it is answered. Settings > Security shows whether it is on, and "Forget this device" turns it off.
- **Restart detection uses the uptime.** With Windows Fast Startup, "Shut down" does not reset it, so only "Restart" (or a full shutdown) brings the password back early. The 7-day rule still applies.
- **Turning it off deletes the Hello key**, which makes any copy of the slot useless. If that deletion fails, an old copy of the slot plus a Hello approval on this PC would still open the data key, because the data key does not change on a password change. "Rotate encryption key" (not in the MVP) is the full answer.
- **A restored copy of a vault** has the same vault id. If it also has the same master password and KDF, the slot opens it too. It is the same vault on the same PC.
- **Windows' signature scheme.** The design relies on Hello signing the same challenge the same way every time (checked on real hardware in the spike). If Windows ever changes that, the slot stops opening, Vaultair falls back to the master password, and the slot is made again.

**Tray.** "Keep running in the tray" only changes what closing the window does: the window hides, the vault locks as it did on quit, and the process stays to skip startup. No key stays in memory because of it.

## Out of scope for the MVP

Sync, browser extension, autofill, breach checks, imports and attachments. Each needs a threat-model update before it's built (see [`future-extension-sync-checklist.md`](future-extension-sync-checklist.md)).

## Explicit non-goals

Vaultair will never implement game cheats, memory reading, anti-cheat bypasses, credential harvesting or stuffing, automated or scripted logins, ban-evasion tools, account selling/transfer, account marketplace integrations, a mandatory cloud account, or tracking/analytics that expose account metadata.
