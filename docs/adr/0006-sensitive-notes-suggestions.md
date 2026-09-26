# ADR-0006: Suggesting proper fields for account details in sensitive notes

- **Status:** Accepted
- **Date:** 2026-09-25
- **Decided by:** project owner (asked for it), trade-offs recorded here

## Context

People paste whatever they have into an account's sensitive notes: the login email, a username, the password, backup codes, security answers. It feels safest, because sensitive notes are encrypted twice (SQLCipher, then a field envelope), hidden until revealed, and never indexed.

But a detail in the notes is invisible to the rest of Vaultair. Recovery dependencies, shared-email detection, the "mailbox has no MFA" flag, password strength and reuse checks, the backup-code count, and search all work on fields, not on free text. The project owner asked the app to recommend moving such details into their own fields, with the security trade-offs weighed.

## What moving a detail changes

| Detail in notes | Where it belongs | Protection after the move | What it gains |
|---|---|---|---|
| Email address, username, gamertag, player ID | Email, Username, Recovery email, Player ID | **Lower.** It loses the field envelope: it's shown without revealing, sits in the search index, and appears in lists. It's still inside the SQLCipher database and every backup's encryption. | Recovery dependencies, shared-email and "mailbox has no MFA" checks, search (Phase 11). |
| Password, PIN | Password, or a hidden custom field | **Same.** Its own field envelope, hidden until revealed. | Strength and reuse checks (Phase 12); revealed or copied (auto-clearing) on its own. |
| Backup or recovery codes | The MFA method's backup codes | **Same.** Encrypted, one code revealed or copied at a time. | "N codes left", and the missing-codes health check (Phase 12). |
| Security question or answer | A hidden custom field | **Same.** | Labelled and copied on its own. |

For the secret kinds the move is a net security gain as well as a feature gain: revealing the sensitive notes shows everything in them at once, while separate fields reveal one value at a time and auto-hide.

For identifiers the move is a real, if small, loss. Identifiers aren't secrets (every service you use knows your email address), so the database-level encryption that remains is the right protection for them, and it matches every other identifier in the vault. What's lost is the extra layer against shoulder-surfing, screen capture (when capture protection is off) and anyone reading the unlocked app, about which address belongs to which account. Someone who deliberately hides that link has a valid reason to decline.

## Decision

1. **Suggest, never move.** Vaultair doesn't rewrite the notes or fill fields by itself. Moving is an edit the user makes, so protection is never lowered silently.
2. **Scan in Rust at save time** (`domain::notes_hints::scan`), on the plaintext the service already holds to encrypt the notes. The result is 4 flag bits (identifiers, credentials, backup codes, security answers) stored in `account.sensitive_notes_hints` inside the encrypted database. No text, position, count or match is stored, returned or logged. Clearing the notes clears the bits.
3. **The account page shows the suggestion** from those flags, with what the move changes for protection, spelled out per kind (the identifiers line says it will show and be searchable). **"Keep in notes" dismisses it** (bit 128) until the notes change. The page never reads the notes to decide.
4. **The form hints live while typing**, with a TypeScript copy of the scan (`notesHints.ts`) running on text already in the form's state. Its test cases match the Rust ones.
5. **Deliberately narrow detection**: an email address, or a label followed by `:` or `=` ("Username:", "PIN ="), or a distinctive phrase ("backup codes", "security question"). Prose such as "changed the password in May" doesn't trigger it. A missed detail costs nothing; a false alarm costs trust.

## Consequences

- The flags reveal a little about encrypted content ("these notes contain an email address") to anything that can read the vault's database or the UI. Anyone who can do that can also decrypt the notes (the field key comes from the same vault keys), so this is metadata inside the same trust boundary, not a new exposure. The canary tests check that the account DTO never carries the notes text.
- Notes saved before V5 have no flags until they're next saved: SQL can't scan encrypted text, and decrypting every note at migration or unlock to scan it isn't worth the exposure for a suggestion.
- The two scanners (Rust and TypeScript) have to stay in step; shared test cases guard that.
