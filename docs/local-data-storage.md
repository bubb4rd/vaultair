# Local data storage

> **Status:** Phase 5. Updated in Phase 14 (backups), Phase 15 (password change, settings) and Phase 15b (Windows Hello unlock, tray). Every file Vaultair writes is listed here.

Vaultair never uploads anything. It makes no network connections (enforced at build time by `deny.toml`).

| What | Where | Encrypted | Contains |
|---|---|---|---|
| Vault folder | Default `%LOCALAPPDATA%\Vaultair\Vaults\<Vault name>\`, or a folder you choose | See rows below | |
| `vault.vhdr` | Vault folder | No (authenticated) | KDF parameters, random salt, the wrapped (encrypted) data key, creation time, vault id. **No user data.** |
| `vault.vdb` | Vault folder | Yes: SQLCipher (AES-256 + HMAC-SHA512 per page), plus a second layer on secret fields | Everything you store: accounts, identities, passwords, codes, notes, search index |
| `vault.vhdr.tmp`, `vault.vhdr.prev` | Vault folder | No (authenticated) | The new and previous header, only while a master password or KDF change is being written. `.prev` opens with the old password, so it is deleted when the change finishes, and any left by a crash is deleted at the next unlock |
| `.lock` | Vault folder | n/a (empty) | Nothing; locked while the vault is open |
| Backups | The backup folder you choose in Settings > Backups: `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup` | Yes: the vault's header and its SQLCipher database, with an HMAC over the whole file | A complete copy of one vault. Opens with the master password the vault had then. A `.vaultair-backup.tmp` file exists only while a backup is being written. See `docs/backup-restore.md` |
| Backup check copy | `%LOCALAPPDATA%\Vaultair\tmp\verify-<id>.vdb` | Yes: SQLCipher, as in the backup | The database from a backup while it is being checked. Deleted when the check ends; one left by a crash is deleted at the next check |
| App config | `%LOCALAPPDATA%\Vaultair\config.json` | No | The recent-vaults list: each vault folder path and when it was last opened (at most 10), the screenshot-protection policy, whether account emails are masked, and whether closing the window keeps Vaultair in the tray. Nothing from inside a vault: the lock and clipboard settings live in the vault itself. A missing or unreadable file just means an empty list and protection on |
| Windows Hello slot | `%LOCALAPPDATA%\Vaultair\devices\<vault id>.qu`, only for a vault with Windows Hello unlock turned on | Yes: the vault's data key, wrapped under a key that only a Windows Hello approval on this PC can rebuild, then wrapped again with Windows DPAPI for your Windows account | The wrapped key, the vault id, when you last typed the master password and in which Windows session, and a count of failed Hello attempts. **No vault contents.** It is not in the vault folder and not in backups, so it never travels with the vault. A `.qu.tmp` file exists only for a moment while it is written. Format: `docs/vault-format.md` §12 |
| Windows Hello key | Inside Windows Hello (the TPM, when this PC has one), named `Vaultair-<vault id>` | n/a | A signing key that can't be exported. Vaultair never sees the private key |
| Logs | `%LOCALAPPDATA%\Vaultair\logs\vaultair.YYYY-MM-DD.log` (7 days kept) | No | App start, vault created/unlocked/locked, error categories. **Never** passwords, secrets, vault names, usernames, emails or file paths |
| WebView2 data | `%LOCALAPPDATA%\app.vaultair.desktop\EBWebView\` | No | Browser engine cache. Vaultair doesn't use web storage (ESLint bans it), so no vault data is here |

**The clipboard** isn't a file, but copies leave Vaultair. Every copy is marked to stay out of Windows clipboard history and cloud clipboard, and is cleared after 30 seconds (Settings > Security, 10 seconds to 5 minutes), when the vault locks, and when Vaultair closes (unless you chose "Keep in clipboard", or you've copied something else since). See `docs/security-assumptions.md` for the limits.

## Where not to put a vault

The default location is deliberately **not** Documents, which on many PCs is synced to OneDrive. If you choose a folder inside OneDrive, Dropbox, Google Drive or iCloud, the encrypted vault files will be uploaded by that service. They stay encrypted, but it breaks the "nothing leaves this device" promise. Onboarding warns when the chosen folder is under a `OneDrive*` root (from the environment variables the OneDrive client sets, which also covers a Documents folder redirected by Known Folder Move), under the default Dropbox, Google Drive, iCloud or Box folder, or has a sync-root name in its path (`OneDrive - <org>`, `Dropbox (…)`, `My Drive`). It is a heuristic warning, not a block (`vault/location.rs`).

## Removing Vaultair's data

- Delete a vault by deleting its folder. Without a backup, that data is gone.
- Delete a backup by deleting its file. Vaultair never deletes or overwrites a backup it finished writing.
- Logs and WebView2 data can be deleted at any time; they hold no vault data.
- Turn Windows Hello unlock off with Settings > Security > "Forget this device", which deletes the slot and the Hello key. Deleting a `.qu` file by hand also turns it off; the vault then opens with the master password as before. Deleting a vault's folder does not remove its slot, so delete the `.qu` file too (it is useless without the vault).
- Deleting `config.json` only empties the recent-vaults list and turns capture protection back on. "Remove from this list" on the lock screen removes one entry and never touches the vault.
