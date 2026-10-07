# Privacy statement (draft)

> **Status:** Phase 4 draft. It is the source for the onboarding copy ("Everything stays on this PC") and will be the source for Settings copy in Phase 15. Final in Phase 16. Keep every claim here true of the shipped build; if a feature changes one, change this file in the same commit.

## The short version

Vaultair is a program on your PC. It has no account, no server and no internet connection. What you put in it stays in an encrypted vault on your disk.

## What Vaultair stores, and where

| What | Where | Encrypted |
|---|---|---|
| Your vault: accounts, identities, passwords, codes, notes | A folder you choose. Default: `%LOCALAPPDATA%\Vaultair\Vaults\<name>` | Yes, with a key made from your master password |
| A list of recently opened vaults (folder paths and when you last opened each), and whether screen-capture protection is on | `%LOCALAPPDATA%\Vaultair\config.json` | No. It holds no vault contents |
| If you turn on Windows Hello unlock: your vault's key, wrapped so that only a Windows Hello approval on this PC can open it | `%LOCALAPPDATA%\Vaultair\devices` | Yes. It holds no vault contents, never leaves this PC, and is not part of the vault or its backups |
| Diagnostic logs (app started, vault created/unlocked/locked, error categories) | `%LOCALAPPDATA%\Vaultair\logs` (7 days) | No. They never contain passwords, secrets, usernames, emails, vault names or file paths |

The full list, including the WebView2 browser-engine cache, is in `docs/local-data-storage.md`.

## What Vaultair never does

- **No network.** Vaultair makes no network connections. That includes no sync, no analytics, no crash reporting, no update checks and no breach lookups. The build fails if a network library is added (`deny.toml`).
- **No account.** There's nothing to sign up for and nobody to sign in to.
- **No copy of your master password.** Vaultair never writes it anywhere. It is used to derive a key and then wiped from Vaultair's own memory. See `docs/forgot-master-password.md`.
- **No browser storage.** The interface never uses web storage, cookies or IndexedDB.
- **No clipboard history.** What you copy from Vaultair is kept out of Windows clipboard history and cloud clipboard, and cleared automatically.

## Things outside Vaultair's control

- **Cloud-synced folders.** If you put your vault in a folder synced by OneDrive, Dropbox, Google Drive, iCloud or Box, that service uploads a copy of the encrypted vault. Vaultair warns you when the folder you choose looks synced.
- **WebView2.** Vaultair draws its window with Microsoft Edge WebView2, part of Windows. Its diagnostic data is governed by your Windows privacy settings, not by Vaultair. Vaultair loads no web pages, only its own bundled interface.
- **Your PC.** Malware running as you, or someone with your unlocked PC, can see what you see. See `docs/threat-model.md`.

## Onboarding copy derived from this file

- "Stored on this PC. Your vault is a folder on this PC. There is no Vaultair account and no Vaultair server."
- "No network connections. Vaultair doesn't connect to the internet. It can't upload, sync or send anything about you."
- "Encrypted with your master password. Everything in the vault is encrypted with a key made from your master password, which Vaultair never stores."
