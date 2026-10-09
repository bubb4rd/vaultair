# Before any sync, browser extension, autofill or breach check

> **Status:** Final for the MVP (Phase 16). Nothing here is built, and none of it is planned for the MVP. This is the list of things that must be true before work on any of it starts. Plan §9 names this file as the gate.

The MVP makes no network connections and has no way for another program to ask it for anything. Each feature below ends one of those two facts. That is why they are gated together: sync and breach checks put data on a network, and an extension or autofill gives a second program a way to request secrets.

A feature is ready to start when every box in "For all of them" and in its own section can be ticked, with the evidence linked. A box nobody can tick is a reason not to start, not a detail to settle later.

## What the MVP gives you to build on

Checked against the code in Phase 16.

| Fact | Where | What it means here |
|---|---|---|
| One data key (DEK) per vault, 32 random bytes, never changed. Everything hangs off it: the database key, the field key, the fingerprint key, the backup MAC key | `crypto/keys.rs`, `vault-format.md` §5 | Anything that holds the DEK can read the whole vault, for good. There is no per-device or per-record key to revoke |
| Changing the master password wraps the same DEK again. "Rotate encryption key" (a new DEK and a full re-encrypt) is not built | `vault/rekey.rs`, `vault-format.md` §8 | A device that once had the DEK keeps access to every copy of the vault file it can still reach |
| The header has a `key_slots` array, and the v1 reader accepts exactly one slot, of kind `password`. Unknown fields are refused | `vault/header.rs` (`validate_structure`, `deny_unknown_fields`), `vault-format.md` §2 rule 4 | A second slot of any kind is a format change. Today's builds would report such a vault as damaged unless `format_version` and `min_reader_version` go up, which makes them say "too new" |
| Windows Hello unlock is not a header slot. It is a file on one PC (`devices\<vault_id>.qu`) that never travels with the vault or its backups | `vault/device_slot.rs`, `vault-format.md` §12, ADR-0005 | `key_slots` is still free for slots that are meant to travel with the vault. Device-bound access already has its own pattern |
| One vault open at a time, in one process. `.lock` is held while it is open, and a second open is refused | `vault/lockfile.rs`, the single-instance plugin | Nothing in the vault expects a second writer |
| The database is one SQLCipher file with a rollback journal (`journal_mode = DELETE`). Records carry `updated_at` and nothing else for ordering: no change log, no per-record version, no tombstones. A permanent delete removes the row | `db/connection.rs`, the migrations | There is no record of what changed, so two diverged copies cannot be merged today |
| A backup is the header plus the database file, byte for byte, with a MAC keyed from the DEK. Restore always makes a new folder | `backup/`, `vault-format.md` §11 | Copying a whole vault safely is solved. Merging two is not |
| No network code. `deny.toml` bans the client crates and the Tauri HTTP, updater, shell and fs plugins. The CSP allows only IPC. ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` | `deny.toml`, `tauri.conf.json`, `eslint.config.js`, `scripts/check-release-config.mjs` | The first network feature has to change each of these on purpose, in review |
| Nothing listens. The only way in is the webview's own IPC, one capability, one window | `src-tauri/capabilities/main.json` | A browser extension needs a new channel, which is a new attack surface that does not exist today |
| A stored secret reaches the UI one field at a time, by an explicit reveal. Copying never sends it to the UI. Lists carry flags, not values | `commands/secret.rs`, `architecture.md` | Any new consumer must keep to this, not get a bulk export |

## For all of them

### 1. Vault correctness comes first

The product spec says it: "Browser extensions and autofill features must not be prioritized over core vault correctness and security."

- [ ] The MVP is released, and the Phase 16 work is done: the threat-model review, the secret-flow audit, clean dependency audits, and the end-to-end smoke test.
- [ ] No open bug that can lose or damage vault data.
- [ ] The automatic backup before a schema migration is built (plan §2.4). It is not today, and a feature that changes the schema on several devices needs it first.
- [ ] Golden fixtures exist for every released format and schema version, and the new work is tested against them (`vault-format.md` §10).
- [ ] A backup made by a released build has been restored on a second PC by hand.
- [ ] If the feature writes to the vault from anywhere but the open app, the single-writer assumption above has been replaced with something tested, not worked around.

### 2. The threat model is updated before the code

- [ ] `threat-model.md` has a section for the feature, written and reviewed before implementation: the new assets, the new attackers, and what changes for each attacker already listed there.
- [ ] Every statement the docs make today that the feature would make false is listed, with its new wording. At least: "No network" (`privacy-statement-draft.md`, onboarding and Settings > Privacy), "Vaultair never uploads anything" (`local-data-storage.md`), and "the MVP makes no network connections" (`threat-model.md`).
- [ ] `security-assumptions.md` lists what the feature newly relies on (a transport, a server the user runs, a browser's extension sandbox, a third party's API).
- [ ] The build-time guards are changed narrowly and on purpose: one named crate allowed in `deny.toml` with the reason, one CSP source, one capability. Not a general loosening. `scripts/check-release-config.mjs` still fails on anything broader.
- [ ] `SECURITY.md` covers the new surface.
- [ ] An ADR records the decision. It supersedes the line in ADR-0004 that keeps these features out of the MVP, and for autofill it must answer ADR-0004's "No auto-fill or auto-login, ever."

### 3. Key-slot design

Any feature that lets a second device, or a second program, open a vault needs its own way to the DEK. Design that first.

- [ ] It is written down which key the new party holds and how it gets it. Sending the master password to it is not a design.
- [ ] If the access should travel with the vault (a recovery key, a second device's key), it is a new header slot, and the design covers: the new `format_version` and `min_reader_version`; what an MVP build shows for that vault ("too new", not "damaged"); and that every slot's wrap is bound to the rest of the header through the AAD, as the password slot's is (`vault-format.md` §4). The AAD already blanks every slot's nonce and ciphertext, so it extends to more slots without a new rule.
- [ ] If the access should stay on one device, it follows the device-slot pattern (ADR-0005): outside the vault folder, never in a backup, bound to the header so a password change voids it.
- [ ] Revocation is real. Because the DEK never changes, taking a slot away does not stop a device that already unwrapped the DEK and kept a copy of the vault. So either "Rotate encryption key" is built first, or the docs say plainly that removing a device does not lock it out of copies it already has.
- [ ] A password change and a KDF change handle every slot: re-wrap it, or delete it and say so. Today's `rekey.rs` writes one slot.
- [ ] The backup container is checked. It carries the whole header, so a backup made after the change includes the new slots. Decide whether that is wanted.
- [ ] The golden fixtures gain a vault with the new slot, and a test that an MVP build refuses it as too new.

### 4. End-to-end encryption only

- [ ] Anything that leaves the PC is ciphertext under a key that only the user's devices hold. No server, relay or cloud folder ever sees the DEK, the master password, a field key, or plaintext.
- [ ] That includes metadata. Account titles, usernames, emails, which platforms and games, the identity graph and the search index are all inside SQLCipher today (`threat-model.md` rates account metadata High). A design that syncs "just the metadata" in the clear fails this box.
- [ ] Password fingerprints never leave the vault. They are HMACs under a per-vault key, useful only for reuse detection inside it.
- [ ] What the transport can still see is written down: file sizes, when changes happen, how many devices. The user is told.
- [ ] The integrity of what comes back is checked before it is used, with a key the transport does not have, as the backup MAC does today.

### 5. Opt-in

- [ ] Off by default, per vault. A vault that never turns it on behaves exactly like an MVP vault: no network connection, no listener, no new files.
- [ ] Turning it on takes the master password, as the sensitive actions in ADR-0005 decision 4 do.
- [ ] The screen that turns it on says what leaves the PC, where it goes, and who can see what, in the plain voice of the rest of the app. It is not buried in a first-run flow.
- [ ] Turning it off is one action, and it says what stays behind on the other side (a copy on a server or another device is not recalled).
- [ ] The privacy promises in onboarding and Settings are rewritten so they stay true with the feature off and with it on. A promise that is only true for some users is not shown to all of them.
- [ ] The no-network build stays possible to check: with the feature off, a test or a capture shows no connection is made.

## Sync

The spec allows it only as "opt-in and use user-controlled storage or self-hosted infrastructure".

### 6. Conflict model

- [ ] It is decided what syncs: the whole vault file, or records.
- [ ] If the whole file: two devices that both changed it produce two files. The design says which one wins, how the other is kept (never silently dropped), and how the user finds out. A cloud folder's "conflicted copy" is not a conflict model. Note that `vault.vdb` and `vault.vhdr` are two files that must match, and a sync client can deliver one before the other.
- [ ] If records: the schema gains what it lacks today. Per-record versions or a change log, tombstones for deletes (a removed row cannot be told apart from "never had it"), and a rule for each derived structure: contact points and the search index are rebuilt, not merged.
- [ ] The rule for two edits to one record is stated, and the user can see and undo the result. "Last write wins" on a password field can lose the only copy of a password; if that is the rule, the older value is kept somewhere the user can reach.
- [ ] Clocks are not trusted for ordering. `updated_at` is the local wall clock.
- [ ] A password change or KDF change on one device, while another is offline, has a defined outcome.
- [ ] Schema versions differ between devices during an update. An older build must refuse a newer vault (it does: "too new") and must never write to one.
- [ ] The vault is never open for writing in two places at once without the model covering it. `.lock` is a local file lock and means nothing across devices.
- [ ] Interrupted and repeated transfers are tested: half a file, the same change twice, changes out of order.
- [ ] A sync that goes wrong can be undone: a backup is made before the first sync and before any merge.

### Also for sync

- [ ] Adding a device is designed under box 3. The new device proves itself to an existing one; nothing is trusted because it reached the same folder or server.
- [ ] The Windows Hello slot stays out of sync. It is per PC by design.
- [ ] The existing warning for vaults in cloud-synced folders is revisited: today it says that puts a copy off the PC, and it should not read as support for syncing that way.

## Browser extension and autofill

ADR-0004 records "No auto-fill or auto-login, ever." Either of these needs that decision reopened in a new ADR first. The spec's non-goals stay as they are: no auto-login scripting for game clients.

Proposed design (not accepted, not built): [ADR-0007](adr/0007-browser-extension-fill-and-save.md), fill and save over Native Messaging and a local named pipe. Its security review (2026-10-09) found 22 issues, all resolved in the ADR's design.

- [ ] The channel between the extension and the app is designed and threat-modelled: who can connect, how the app knows it is the user's extension and not another program running as the user, and what a malicious web page can make the extension ask for.
- [ ] The extension gets no key and no bulk access. It asks for one credential for one site, the app decides, and the vault must be unlocked. A locked vault answers nothing, not even whether an account exists.
- [ ] The site is matched in Rust against the stored URL by exact origin rules that are written down (no substring matching, no matching on page titles), and a mismatch is a refusal.
- [ ] Every fill is a user action in front of the keyboard. Nothing is filled on page load, and nothing is submitted.
- [ ] The value takes the shortest path and is not logged, cached or kept by the extension. The canary tests are extended to the new channel.
- [ ] The rule that stored secrets reach the UI one at a time by explicit reveal still holds. The extension is not a second, weaker UI.
- [ ] The extension's own permissions, update channel and store listing are in the threat model: an extension update is code that reaches the user by a different route from the app.
- [ ] Passkeys are separate (Phase 17 in the README) and have their own scope.

## Breach checks

The spec: "do not implement it in the first MVP unless its privacy model is fully specified and reviewed."

- [ ] The privacy model is written and reviewed: exactly what is sent, to whom, and what that party can learn from it and from the timing and the IP address.
- [ ] No password, no full password hash, no email address and no username leaves the PC. A k-anonymity range query on a hash prefix is the least that is acceptable, and the docs say what it still reveals.
- [ ] The vault's own fingerprints are not used for it: they are keyed per vault and are not hashes any service knows.
- [ ] It runs when the user asks, per check or per vault setting, never in the background by default.
- [ ] An offline option is considered first (a hash set the user downloads themselves), since it needs no connection from Vaultair at all.
- [ ] Results are stored inside the vault only, and say when the check was made.
- [ ] Boxes 2, 4 and 5 are ticked: this is a network feature like any other.

## Related

- `docs/vault-format.md` §2 (header and reader rules), §4 (key wrap and AAD), §8 (password change), §12 (device slot)
- `docs/threat-model.md`, `docs/security-assumptions.md`
- `docs/adr/0003-vault-layout.md` (key slots), `docs/adr/0004-mvp-scope-decisions.md` (what is out of the MVP), `docs/adr/0005-quick-unlock.md` (the device-slot pattern)
- `docs/adr/0007-browser-extension-fill-and-save.md` (proposed: browser fill and save)
- `docs/product-spec.md` ("Future Roadmap")
