# Backup and restore

> **Status:** Final for the MVP (Phase 16), checked against the code. Format details: [`vault-format.md`](vault-format.md) §11.

A backup is one file, `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup`, holding a whole vault: its header and its encrypted database. The date and time in the name are UTC. The name itself is not encrypted, so the vault's name and the backup's date are readable wherever the file is kept, including a cloud-synced folder.

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

## Before an upgrade

A newer Vaultair sometimes needs to upgrade a vault's database to open it. When you unlock a vault that needs one, Vaultair first makes a backup of it, exactly as the older version left it, and only then upgrades it. You don't have to do anything.

- **Where:** `%LOCALAPPDATA%\Vaultair\upgrade-backups\`, with the usual name, `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup`. Not your backup folder: that may be on a drive that isn't connected, and an upgrade mustn't depend on it.
- **Checked:** it is read back the same way as Back up now (see "What the check covers") before the upgrade starts.
- **If it can't be made,** the vault doesn't open and isn't changed. The lock screen says that the safety copy couldn't be written and why: the disk is full, the folder can't be written to, or the copy didn't read back. Fix that and unlock again. There is no way to upgrade without the copy.
- **Kept:** Vaultair never deletes these. They are small, and each one is the only way back to the older Vaultair for that vault. Delete them yourself when you no longer need them.
- **Not your backup:** it doesn't count as the last backup in Settings and doesn't change "Backup due".
- Every vault gets one, demo vaults included. A new vault, or one that is already up to date, doesn't.

Settings > Backups shows "Copies made before an upgrade" with an **Open folder** button once the folder exists.

### Going back to an older Vaultair

An older Vaultair can't open a vault a newer one has upgraded: it says the vault was made by a newer version. To go back:

1. Install the older Vaultair.
2. On its lock screen, choose **Restore a backup** and pick the file in `upgrade-backups` from just before the upgrade.
3. Restore it to a new folder (a restore never writes over a vault) with the master password the vault had then.

The restored vault is the vault as it was before the upgrade. Anything you changed after the upgrade is only in the upgraded vault.

## What can go wrong

| Message | Meaning |
|---|---|
| "That file isn't a Vaultair backup, or it has been damaged." | Not a backup, cut short, or changed since it was made. Use another backup. |
| "Incorrect master password." | Not the password that backup was made with. Try the password you used at that time. |
| "That backup belongs to a different vault. Restore it to check it." | Check a backup only works for the open vault's own backups. |
| "Vaultair couldn't write to the backup folder…" | The folder is missing, the drive is not connected, or it is full or read-only. |
| "That folder already contains files…" | A restore needs a new or empty folder. Change the name or the folder. |
| "This vault was made by a newer version of Vaultair…" | The backup was made by a newer version. Update Vaultair to restore it. |
| "This vault needs an upgrade, and Vaultair makes a safety copy of it first…" | The copy made before an upgrade couldn't be written: the disk is full, `%LOCALAPPDATA%\Vaultair\upgrade-backups` can't be written to, or the copy didn't read back. The vault was not changed. See "Before an upgrade". |

## Not in this version

- Scheduled backups. Apart from the copy made before an upgrade, backups are made when you press the button.
- CSV or any other plaintext export.
- Restoring over an existing vault.
