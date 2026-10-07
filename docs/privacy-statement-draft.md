# Privacy statement (draft)

> **Status:** Final for the MVP (Phase 16), checked against the code. It is the source for the onboarding copy ("Everything stays on this PC") and for Settings > Privacy ("What Vaultair never does"). Keep every claim here true of the shipped build; if a feature changes one, change this file and the two screens in the same commit.

## The short version

Vaultair is a program on your PC. It has no account, no server and no internet connection. What you put in it stays in an encrypted vault on your disk.

## What Vaultair stores, and where

| What | Where | Encrypted |
|---|---|---|
| Your vault: accounts, identities, passwords, codes, notes | A folder you choose. Default: `%LOCALAPPDATA%\Vaultair\Vaults\<name>` | Yes, with a key made from your master password |
| Backups, when you make them: a complete copy of one vault in one file | A folder you choose in Settings > Backups | Yes, the same way as the vault. A backup opens with the master password the vault had when it was made |
| A list of recently opened vaults (folder paths and when you last opened each), and four settings that belong to the app, not to one vault: screenshot protection, whether account emails are masked, whether closing the window keeps Vaultair in the tray, and whether you asked not to be offered Windows Hello unlock | `%LOCALAPPDATA%\Vaultair\config.json` | No. It holds no vault contents |
| If you turn on Windows Hello unlock: your vault's key, wrapped so that only a Windows Hello approval on this PC can open it | `%LOCALAPPDATA%\Vaultair\devices` | Yes. It holds no vault contents, never leaves this PC, and is not part of the vault or its backups |
| Diagnostic logs (app started, vault created/unlocked/locked, settings changed, backups made, error categories) | `%LOCALAPPDATA%\Vaultair\logs` (7 days) | No. They never contain passwords, secrets, usernames, emails, vault names or file paths |

The full list, including the WebView2 browser-engine cache, is in `docs/local-data-storage.md`.

## What Vaultair never does

- **No network.** Vaultair makes no network connections. That includes no sync, no analytics, no crash reporting, no update checks and no breach lookups. The build fails if a network library is added (`deny.toml`).
- **No account.** There's nothing to sign up for and nobody to sign in to.
- **No copy of your master password.** Vaultair never writes it anywhere. It is used to derive a key and then wiped from Vaultair's own memory. See `docs/forgot-master-password.md`.
- **No browser storage.** The interface never uses web storage, cookies or IndexedDB.
- **No clipboard history.** What you copy from Vaultair is kept out of Windows clipboard history and cloud clipboard, and cleared automatically.

## Things outside Vaultair's control

- **Cloud-synced folders.** If you put your vault or your backups in a folder synced by OneDrive, Dropbox, Google Drive, iCloud or Box, that service uploads a copy of the encrypted files. Vaultair warns you when the folder you choose looks synced. The check goes by folder names and can miss one.
- **Your browser.** "Open login page" on an account hands that page's address to your default browser, and the browser connects to the site. Vaultair itself still connects to nothing, and it never fills in or sends a username or password.
- **The clipboard.** While a copied value is on the clipboard, any program running as you can read it, and a clipboard manager from another company may keep it. See `docs/security-assumptions.md`.
- **WebView2.** Vaultair draws its window with Microsoft Edge WebView2, part of Windows. Its diagnostic data is governed by your Windows privacy settings, not by Vaultair. Vaultair loads no web pages, only its own bundled interface.
- **Your PC.** Malware running as you, or someone with your unlocked PC, can see what you see. See `docs/threat-model.md`.

## Onboarding copy derived from this file

`src/features/onboarding/steps.tsx`, the screen "Everything stays on this PC":

- "Stored on this PC. Your vault is a folder on this PC. There is no Vaultair account and no Vaultair server."
- "No network connections. Vaultair doesn't connect to the internet. It can't upload, sync or send anything about you."
- "Encrypted with your master password. Everything in the vault is encrypted with a key made from your master password, which Vaultair never stores."

## Settings copy derived from this file

`src/features/settings/Privacy.tsx` shows "What Vaultair never does" as five lines:

- "No network. Vaultair makes no network connections: no sync, no analytics, no crash reports, no update checks and no breach lookups."
- "No account. There is nothing to sign up for and nobody to sign in to."
- "No copy of your master password. It is used to make a key and then wiped from Vaultair's memory. It is never written anywhere."
- "No browser storage. The interface never uses web storage, cookies or IndexedDB."
- "No clipboard history. What you copy is kept out of Windows clipboard history and cloud clipboard, and cleared automatically."

Under the logs folder it says: "Seven days of app events and error categories. They never hold passwords, secrets, usernames, emails, vault names or file paths."
