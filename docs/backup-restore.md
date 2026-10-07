# Backup and restore

> **Status:** Final for the MVP (Phase 16), checked against the code. Format details: [`vault-format.md`](vault-format.md) §11.

A backup is one file, `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup`, holding a whole vault: its header and its encrypted database. The date and time in the name are UTC.

## What a backup is, and isn't

- **Encrypted the same way as the vault.** The database inside is the SQLCipher file as it is on disk. Nothing is decrypted to make a backup, and no plaintext is written anywhere.
- **It opens with the master password the vault had when the backup was made.** Changing the master password later does not change older backups. Keep the old password for as long as you keep the old backup.
- **There is still no recovery.** A backup protects against a lost disk or a damaged vault. It does not help with a forgotten master password. See [`forgot-master-password.md`](forgot-master-password.md).
- **It is only as strong as the master password.** Someone who takes a backup file can try passwords against it for as long as they like. See [`threat-model.md`](threat-model.md).

## Making a backup

Settings > Backups.

1. **Choose a backup folder.** Use a USB drive or another disk. Vaultair refuses a folder inside the vault's own folder, because that backup would be lost with the vault. A folder synced by OneDrive, Dropbox, Google Drive, iCloud or Box gets a warning: the backups stay encrypted, but that service uploads a copy of each.
2. **Back up now.** Vaultair writes the file, then reads it back before saying it worked (see "What the check covers"). A backup that doesn't read back is deleted and reported as a failure.

An existing backup is never overwritten. A second backup in the same second gets `-2` on its name.

Settings shows when the last successful backup was made and where, and says so if the most recent attempt failed. The dashboard and Settings show "Backup due" when the vault has no backup, or the last one is 30 days old or more. A demo vault is never reminded.

The backup folder and the last result are stored inside the vault, so they are in the next backup and come back with a restore.

## Checking a backup

Settings > Backups > **Check a backup**, then choose the file.

### What the check covers

1. The file's layout: the marker, the version and the lengths add up to the file's size.
2. An HMAC-SHA256 over the whole file, keyed from the vault's own key. Any changed, missing or added byte fails here.
3. The database is copied to `%LOCALAPPDATA%\Vaultair\tmp\verify-<id>.vdb`, still encrypted, and opened with the vault's key. Every page's HMAC and the SQLite structure are checked, and the vault id inside must match. The copy is deleted afterwards.

Only a backup of the vault that is open can be checked this way, because the key comes from that vault. A backup of another vault says so. To check that one, restore it: a restore runs the same checks with that backup's password.

## Restoring

**Restore a backup** is on the lock screen and in Settings > Backups. It works without opening a vault, because a restore is what you need when a vault won't open.

1. Choose the backup file.
2. Choose a name and a folder for the restored vault. The default folder is where vaults normally live.
3. Enter the master password the vault had when the backup was made.

A restore **always makes a new vault folder**. It never writes over a vault: the folder must be new or empty. The restored vault is named after its folder and is added to the list on the lock screen. From Settings, the vault you have open is not touched.

The same checks as "Check a backup" run before the restored vault's header is written. If any fail, or the password is wrong, the new folder is removed and nothing is left behind.

The restored vault is a copy of the same vault: it keeps the original's vault id, its master password as of the backup, and its key-derivation settings. So "Check a backup" in either copy accepts backups made from the other.

To replace a damaged vault: restore to a new name, open the restored vault and confirm it has what you expect, then delete the old vault's folder yourself.

## What can go wrong

| Message | Meaning |
|---|---|
| "That file isn't a Vaultair backup, or it has been damaged." | Not a backup, cut short, or changed since it was made. Use another backup. |
| "Incorrect master password." | Not the password that backup was made with. Try the password you used at that time. |
| "That backup belongs to a different vault. Restore it to check it." | Check a backup only works for the open vault's own backups. |
| "Vaultair couldn't write to the backup folder…" | The folder is missing, the drive is not connected, or it is full or read-only. |
| "That folder already contains files…" | A restore needs a new or empty folder. Change the name or the folder. |
| "This vault was made by a newer version of Vaultair…" | The backup was made by a newer version. Update Vaultair to restore it. |

## Not in this version

- Scheduled or automatic backups. Backups are made when you press the button.
- An automatic backup before a schema migration. The plan calls for one once migrations ship to released vaults.
- CSV or any other plaintext export.
- Restoring over an existing vault.
