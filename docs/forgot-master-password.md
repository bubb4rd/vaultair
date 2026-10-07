# Forgot your master password?

> **Status:** Final for the MVP (Phase 16), checked against the code. It is the source for the onboarding screen "We can't recover your master password" and the recovery checklist.

## The honest answer

If you forget your master password, **your vault can't be opened**. Not by you, not by Vaultair's makers, not by anyone.

That's deliberate, and it's what protects you:

- Your vault is encrypted with a key made from your master password (Argon2id, then XChaCha20-Poly1305; see `docs/vault-format.md`).
- Vaultair never stores the password, a hint, or anything that could rebuild it.
- There is no server and no account, so there is no "reset password" link.

A recovery backdoor would also be a way in for anyone who found it.

## What you can do now, before you forget

The optional checklist at the end of onboarding suggests the following. Vaultair saves none of it:

1. Write it on paper and keep it somewhere private at home, with your other important documents.
2. Don't keep it in a note on this PC, a photo on your phone, or a cloud document.
3. Don't use it for anything else.
4. Type it a few times over the next week so it sticks.

Plan for backups too (Settings > Backups; see [`backup-restore.md`](backup-restore.md)). A backup opens with the master password it was made with, so keep that password as well. A backup does not get you back in if you forget the password.

## If you have already forgotten it

- Try the passphrases you usually use, carefully. Watch for Caps Lock and your keyboard layout.
- After five wrong attempts, the lock screen makes you wait between tries: 5 seconds, then 10, 20, 40, and 60 from then on. That's a speed bump, not a lockout; nothing is deleted, and restarting Vaultair starts the count again.
- If you can't get in, the vault stays encrypted on disk. You can create a new vault and start again. Deleting the old vault's folder removes it for good.

## What Vaultair will never offer

Password hints, security questions, "recovery keys" held by anyone but you, or unlocking with a Windows account alone.

**Windows Hello unlock is not a way back in.** If you turned it on (Settings > Security), your PIN, fingerprint or face can unlock the vault on that PC, but only between master-password unlocks: Vaultair asks for the password again after Windows restarts, every 7 days, and after 3 failed Hello attempts. It can't create a vault, restore a backup or change the password. If you have forgotten the master password and Hello still unlocks the vault today, use that session to copy what you need into a new vault with a password you know; you can't change the password of the old one without it. See [ADR-0005](adr/0005-quick-unlock.md).
