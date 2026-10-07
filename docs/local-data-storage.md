# Local data storage

> **Status:** Final for the MVP (Phase 16), checked against the code. Every file Vaultair writes is listed here.

Vaultair never uploads anything. It makes no network connections (enforced at build time by `deny.toml`).

| What | Where | Encrypted | Contains |
|---|---|---|---|
| Vault folder | Default `%LOCALAPPDATA%\Vaultair\Vaults\<Vault name>\`, or a folder you choose | See rows below | |
| `vault.vhdr` | Vault folder | No (authenticated) | KDF parameters, random salt, the wrapped (encrypted) data key, creation time, vault id, and whether it is a demo vault. **No user data.** |
| `vault.vdb` | Vault folder | Yes: SQLCipher (AES-256 + HMAC-SHA512 per page), plus a second layer on secret fields | Everything you store: accounts, identities, passwords, codes, notes, search index. Also the vault's own settings: its name and colour, the lock and clipboard timings, and the backup folder path with the last backup's path and result. While a change is being written SQLite keeps a `vault.vdb-journal` beside it, encrypted the same way, and deletes it afterwards |
| `vault.vhdr.tmp`, `vault.vhdr.prev` | Vault folder | No (authenticated) | The new and previous header, only while a master password or KDF change is being written. `.prev` opens with the old password, so it is deleted when the change finishes, and any left by a crash is deleted at the next unlock |
| `.lock` | Vault folder | n/a (empty) | Nothing; locked while the vault is open |
| Backups | The backup folder you choose in Settings > Backups: `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup` | Yes: the vault's header and its SQLCipher database, with an HMAC over the whole file | A complete copy of one vault. Opens with the master password the vault had then. The file's name is not encrypted: it shows the vault's name and when the backup was made, to anyone who can list the folder (including a cloud service it syncs to). A `.vaultair-backup.tmp` file exists only while a backup is being written. See `docs/backup-restore.md` |
| Backup check copy | `%LOCALAPPDATA%\Vaultair\tmp\verify-<id>.vdb` | Yes: SQLCipher, as in the backup | The database from a backup while it is being checked. Deleted when the check ends; one left by a crash is deleted at the next check |
| App config | `%LOCALAPPDATA%\Vaultair\config.json` | No | The recent-vaults list: each vault folder path and when it was last opened (at most 10), the screenshot-protection policy, whether account emails are masked, whether closing the window keeps Vaultair in the tray, and whether you asked not to be offered Windows Hello unlock again. Nothing from inside a vault: the lock and clipboard settings live in the vault itself. A `config.json.tmp` exists only for a moment while it is written. A missing or unreadable file just means an empty list and protection on |
| Windows Hello slot | `%LOCALAPPDATA%\Vaultair\devices\<vault id>.qu`, only for a vault with Windows Hello unlock turned on | Yes: the vault's data key, wrapped under a key that only a Windows Hello approval on this PC can rebuild, then wrapped again with Windows DPAPI for your Windows account | The wrapped key, the vault id, when you last typed the master password and in which Windows session, and a count of failed Hello attempts. **No vault contents.** It is not in the vault folder and not in backups, so it never travels with the vault. A `.qu.tmp` file exists only for a moment while it is written. Format: `docs/vault-format.md` §12 |
| Windows Hello key | Inside Windows Hello (the TPM, when this PC has one), named `Vaultair-<vault id>` | n/a | A signing key that can't be exported. Vaultair never sees the private key |
| Logs | `%LOCALAPPDATA%\Vaultair\logs\vaultair.YYYY-MM-DD.log` (7 days kept) | No | A timeline of what the app did, without the contents. See "What the logs hold" below. **Never** passwords, secrets, vault names, account titles, usernames or emails |
| WebView2 data | `%LOCALAPPDATA%\app.vaultair.desktop\EBWebView\` (the app identifier in `tauri.conf.json`; confirmed on a dev PC) | No | Browser engine cache. Vaultair doesn't use web storage (ESLint bans it), so no vault data is here |

**The clipboard** isn't a file, but copies leave Vaultair. Every copy is marked to stay out of Windows clipboard history and cloud clipboard, and is cleared after 30 seconds (Settings > Security, 10 seconds to 5 minutes), when the vault locks, and when Vaultair closes (unless you chose "Keep in clipboard", or you've copied something else since). Selecting a secret that is shown on screen and pressing Ctrl+C or Ctrl+X is sent the same way, so it is protected like the Copy button. Copying out of a field you can type in (a secret you are typing with its eye icon on, or sensitive notes or recovery steps opened for editing) is an ordinary Windows copy: it goes into clipboard history and the cloud clipboard if you use them, and Vaultair never clears it. See `docs/security-assumptions.md` for the limits.

## What the logs hold

The logs are plain text, so it matters what is in them. Checked against every log call in the code:

- App start and version; vault created, unlocked (by password or Windows Hello) and locked, with the reason for the lock; the KDF parameters when a vault is created or re-keyed.
- Each record created, changed, archived or deleted, as its kind and its internal id: "account updated" with the account's id. An id is a random UUID, which says nothing about the record, except for a built-in platform, game or purpose label, whose id names it (`builtin-pl-steam`). Bulk actions log a count.
- Each time a secret is revealed or copied, as its kind only ("account password", "totp code"), not which account and never the value.
- Settings changes with the new values (timeouts, screenshot protection, tray), backups made (size only) or failed, Windows Hello unlock turned on or off, and error categories with static descriptions and numeric codes.

So someone who can read the logs learns when Vaultair was used and roughly what was done, for the last seven days. They do not learn what any record contains or is called.

**File paths.** The logs never contain a path to a file or folder on your PC: not a vault's folder, not a backup's, not anything else. No log call of Vaultair's own passes a path. Errors are logged as fixed descriptions and numeric codes; when the app framework (Tauri) itself fails (the app can't start, the tray icon can't be made or changed, an event can't be sent to the window, the webview can't be reached for hardening), the log gets the kind of error and none of its text, which Vaultair doesn't write and which could quote a path. A crash is logged by where in the program it happened, with a line number and never the message: a place in Vaultair's source code (`src-tauri/src/lock.rs`) or in a library (`tauri-2.11.6/src/app.rs`). That names a source file, not a file on any PC; the folders of the PC that built Vaultair, which the compiler records for a library, are cut off before logging. Tests in `src-tauri/src/logging.rs` cover both.

## Where not to put a vault

The default location is deliberately **not** Documents, which on many PCs is synced to OneDrive. If you choose a folder inside OneDrive, Dropbox, Google Drive or iCloud, the encrypted vault files will be uploaded by that service. They stay encrypted, but it breaks the "nothing leaves this device" promise. Onboarding and restore warn when the chosen folder is under a `OneDrive*` root (from the environment variables the OneDrive client sets, which also covers a Documents folder redirected by Known Folder Move), under the default Dropbox, Google Drive, iCloud or Box folder, or has a sync-root name in its path (`OneDrive`, `OneDrive - <org>`, `Dropbox`, `Dropbox (…)`, `Google Drive`, `My Drive`, `Shared drives`, `iCloud Drive`). Settings > Backups gives the same warning for the backup folder. It is a heuristic warning, not a block (`vault/location.rs`): a sync folder with another name, or another sync service, is not noticed.

## Removing Vaultair's data

- Delete a vault by deleting its folder. Without a backup, that data is gone.
- Delete a backup by deleting its file. Vaultair never deletes or overwrites a backup it finished writing.
- Logs and WebView2 data can be deleted at any time; they hold no vault contents.
- Turn Windows Hello unlock off with Settings > Security > "Forget this device", which deletes the slot and the Hello key. Deleting a `.qu` file by hand also turns it off; the vault then opens with the master password as before. Deleting a vault's folder does not remove its slot, so delete the `.qu` file too (it is useless without the vault).
- Deleting `config.json` only empties the recent-vaults list and turns capture protection back on. "Remove from this list" on the lock screen removes one entry and never touches the vault.
