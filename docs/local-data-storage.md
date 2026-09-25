# Local data storage

> **Status:** Phase 4. Updated in Phase 14 (backups). Every file Vaultair writes is listed here.

Vaultair never uploads anything. It makes no network connections (enforced at build time by `deny.toml`).

| What | Where | Encrypted | Contains |
|---|---|---|---|
| Vault folder | Default `%LOCALAPPDATA%\Vaultair\Vaults\<Vault name>\`, or a folder you choose | See rows below | |
| `vault.vhdr` | Vault folder | No (authenticated) | KDF parameters, random salt, the wrapped (encrypted) data key, creation time, vault id. **No user data.** |
| `vault.vdb` | Vault folder | Yes: SQLCipher (AES-256 + HMAC-SHA512 per page), plus a second layer on secret fields | Everything you store: accounts, identities, passwords, codes, notes, search index |
| `.lock` | Vault folder | n/a (empty) | Nothing; locked while the vault is open |
| App config | `%LOCALAPPDATA%\Vaultair\config.json` | No | The recent-vaults list: each vault folder path and when it was last opened (at most 10). Nothing from inside a vault. A missing or unreadable file just means an empty list |
| Logs | `%LOCALAPPDATA%\Vaultair\logs\vaultair.YYYY-MM-DD.log` (7 days kept) | No | App start, vault created/unlocked/locked, error categories. **Never** passwords, secrets, vault names, usernames, emails or file paths |
| WebView2 data | `%LOCALAPPDATA%\app.vaultair.desktop\EBWebView\` | No | Browser engine cache. Vaultair doesn't use web storage (ESLint bans it), so no vault data is here |

## Where not to put a vault

The default location is deliberately **not** Documents, which on many PCs is synced to OneDrive. If you choose a folder inside OneDrive, Dropbox, Google Drive or iCloud, the encrypted vault files will be uploaded by that service. They stay encrypted, but it breaks the "nothing leaves this device" promise. Onboarding warns when the chosen folder is under a `OneDrive*` root (from the environment variables the OneDrive client sets, which also covers a Documents folder redirected by Known Folder Move), under the default Dropbox, Google Drive, iCloud or Box folder, or has a sync-root name in its path (`OneDrive - <org>`, `Dropbox (…)`, `My Drive`). It is a heuristic warning, not a block (`vault/location.rs`).

## Removing Vaultair's data

- Delete a vault by deleting its folder. Without a backup, that data is gone.
- Logs and WebView2 data can be deleted at any time; they hold no vault data.
- Deleting `config.json` only empties the recent-vaults list. "Remove from this list" on the lock screen removes one entry and never touches the vault.
