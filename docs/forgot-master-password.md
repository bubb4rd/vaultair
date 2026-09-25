# Forgot your master password?

> **Status:** Phase 4. It is the source for the onboarding screen "We can't recover your master password" and the recovery checklist. Final in Phase 16.

## The honest answer

If you forget your master password, **your vault can't be opened**. Not by you, not by Vaultair's makers, not by anyone.

That's deliberate, and it's what protects you:

- Your vault is encrypted with a key made from your master password (Argon2id, then XChaCha20-Poly1305; see `docs/vault-format.md`).
- Vaultair never stores the password, a hint, or anything that could rebuild it.
- There is no server and no account, so there is no "reset password" link.

A recovery backdoor would also be a way in for anyone who found it.

## What you can do now, before you forget

The optional checklist at the end of onboarding suggests the following. Vaultair saves none of it:

1. Write the password on paper and keep it somewhere private at home, with your other important documents.
2. Don't keep it in a note on your PC, a photo on your phone, or a cloud document.
3. Don't use it for anything else.
4. Type it a few times over the first week so it sticks.

Plan for backups too. Encrypted backups arrive in Phase 14. A backup opens with the master password it was made with, so keep that password as well.

## If you have already forgotten it

- Try the passphrases you usually use, carefully. Watch for Caps Lock and your keyboard layout.
- After five wrong attempts, the lock screen makes you wait a few seconds between tries. That's a speed bump, not a lockout; nothing is deleted.
- If you can't get in, the vault stays encrypted on disk. You can create a new vault and start again. Deleting the old vault's folder removes it for good.

## What Vaultair will never offer

Password hints, security questions, "recovery keys" held by anyone but you, or unlocking with a Windows account alone. Quick unlock with Windows Hello may come later (roadmap Phase 2). It would only ever sit *alongside* the master password, and it could never create or recover a vault on its own (see `docs/implementation-plan.md` §5).
