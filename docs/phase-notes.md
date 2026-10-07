# Phase notes

Implementation log from the phased build (Phases 0–17). For current product behavior, use the docs linked from [README.md](../README.md).

## Phase notes

The notes below are a log. Each section records what was true when that phase landed, including what it left for later, and later phases closed many of those gaps. For the app as it is now, read the docs linked from [README.md](../README.md); "Phase 16 notes" lists what is still open.

## Phase 0 notes

- **SQLCipher build spike (2026-09-23): passed.** `rusqlite 0.37` + `bundled-sqlcipher-vendored-openssl` built on Windows/MSVC with Strawberry Perl; NASM was not needed. It produced SQLCipher 4.6.1 (OpenSSL 3.6). Verified: no plaintext on disk, a wrong raw key is rejected, FTS5 works inside the encrypted DB. A cold build takes about 8 min (OpenSSL), so the CI cache matters.
- **Phase 3 note:** on a wrong key, SQLCipher logs `hmac check failed` to stderr. Done in Phase 3: `PRAGMA cipher_log_level = NONE` is set on every open.
- **Building SQLCipher locally:** `.cargo/config.toml` points `openssl-src` at `C:/Strawberry/perl/bin/perl.exe`, so builds work from any shell.

## Phase 3 notes

- Unlock at calibrated parameters: **0.89 s** at Argon2id 512 MiB, t=3, p=4 on the dev machine (target â‰¤ 1.5 s). Re-measure with `cargo test --release -p vaultair-core --test vault_integration -- --ignored unlock_time --nocapture`.

## Phase 4 notes

- Driven end to end in the real webview (2026-09-24): onboarding, create, Ctrl+L lock, wrong password, unlock, force-kill and restart, unlock again, lock from the sidebar. Create (calibration + Argon2 + SQLCipher) took 1.1 s, unlock 0.8 s, in a debug build.
- To drive the app from a script: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` before `npm run tauri dev` and attach with Playwright `chromium.connectOverCDP`. Point `LOCALAPPDATA` at a scratch folder so test vaults and `config.json` don't land in your real profile.
- No `tauri-plugin-dialog` (it pulls in the banned `tauri-plugin-fs`); the folder picker is native, in `vaultair-platform`.
- **Lock screen redesign (2026-10-06, owner request):** the lock / pick-vault screen is now a split layout, the form on the left and a hero panel on the right (the owner's dark blockchain backdrop, a floating feature card and a tagline), modelled on two split-panel sign-in references. Behaviour and IPC are unchanged; the layout is described in `docs/design-system.md` (Onboarding and lock screen).
- Not done in Phase 4: `app_config_get/update` (there is nothing user-configurable before Phase 5; `config.json` currently holds only the recent-vaults list), and routing `vault_locked` errors from data commands to the lock screen (no data commands exist until Phase 7).

## Phase 5 notes

- Driven end to end in the real webview (2026-09-25, 14/14): a copy lands on the clipboard with the three history/cloud exclusion formats; it clears at the timeout; "Keep in clipboard" stops the clear; a later copy by the user is never cleared; `WM_WTSSESSION_CHANGE`/`WTS_SESSION_LOCK` and `WM_POWERBROADCAST`/`PBT_APMSUSPEND` sent to the window lock the vault, clear the clipboard and return the UI to the lock screen; minimize doesn't lock (default off); idle lock fired 20.8 s after unlock with a 20 s timeout. Closing the window clears a pending copy and locks (`reason=Exit`).
- Found while driving it: at exit the window is already destroyed, so `OpenClipboard(owner)` failed and the value stayed on the clipboard. Clearing now opens without an owner when the owner is gone; the ignored real-clipboard test covers it.
- Checked by hand (2026-09-25, passed): Win+L locks the vault; a copied value doesn't appear in Win+V history; with capture protection on, screen capture doesn't show the window.
- Dev-only overrides for trying timeouts: `VAULTAIR_DEV_IDLE_LOCK_SECS` and `VAULTAIR_DEV_CLIPBOARD_CLEAR_SECS` (debug builds only; release ignores them). Settings > Developer checks (debug builds only) has "Copy sample value" and a capture-protection toggle until Phase 7 and Phase 15 add the real UI.
- Toasts (owner request): one app-wide `<Toaster />` for success, error, warning and info, with keycaps, actions and a countdown, and enter/exit/collapse transitions (see `docs/design-system.md`). The lock screen says why the vault locked, which Rust keeps across the webview reload. Try them from Settings > Developer checks > Preview notifications.
- Real-clipboard test (overwrites your clipboard): `cargo test -p vaultair-platform -- --ignored --test-threads=1 real_clipboard`.
- Not done in Phase 5: persisting a pending clear across a crash (optional in the plan; a crash before the timeout leaves the value on the clipboard), and editable lock and clipboard settings (Phase 15; the ADR-0004 defaults apply, and capture protection is stored in `config.json`).

## Phase 6 notes

- Generator lives in `vaultair-core::generator`: OS randomness (`getrandom`), an unbiased index sampler (rejects the uneven tail instead of `x % n`), and "every selected type appears" by redrawing the whole password, never by planting characters. Entropy is exact: inclusionâ€“exclusion over the required types for passwords, `words Ã— log2(7776)` (+ `log2(10 Ã— words)` with a number) for passphrases. zxcvbn's 0â€“4 score is shown alongside.
- Symbols are ASCII punctuation minus quotes, backtick, backslash, pipe and space (`!#$%&()*+,-./:;<=>?@[]^_{}~`). "Avoid look-alike characters" removes `Il1O0o`; "Leave out characters" takes any extra set. Leaving out every character of a selected type is an `invalid_input` error on `exclude`, shown on the field.
- Copying uses `clipboard_copy_plain` (auto-clear, kept out of Win+V history). Options are remembered in memory only until Settings arrive in Phase 15; a lock resets them.
- `GeneratorPopover` (compact, "Use password") is built and tested for the Phase 7 account form; nothing mounts it yet.
- Uniformity check (slow, ignored by default): `cargo test --release -p vaultair-core characters_are_uniform -- --ignored`. zxcvbn now builds at `opt-level = 3` in dev too, which took the core tests from 43 s to 4 s.

## Phase 7 notes

- Not done in Phase 7: the lint rule against putting reveal results in query cache keys (plan Â§Phase 7 risks). Every reveal (`SecretField`, `AccountForm`, `MfaSection`, the TOTP code) keeps the value in component state today, but nothing enforces it. The rule is `no-restricted-syntax` entries in `eslint.config.js` flagging `secrets.reveal` / `mfa.totpCode` inside `queryKey`/`queryFn`/`mutationKey`, `useQuery`/`useQueries`/`queryOptions`, or `setQueryData`/`fetchQuery`/`prefetchQuery`.

## Phase 8 notes

- Contact points are derived, not edited: an account save upserts its login email, recovery email and recovery phone, and an identity save upserts its primary email, recovery email and phone. `contact_point.value_normalized` uses `normalize_contact` (trim + ASCII lowercase, the same as SQLite's `lower()`), backed by the `UNIQUE (kind, value_normalized)` constraint. Unused contact points are pruned in the same transaction. So the plan's `contact_point_*` commands are just `contact_point_list` (form suggestions). No upsert or delete command exists, because nothing in the UI needs one.
- V3 adds `contact_point.value_display` and backfills login-email contact points for accounts saved before Phase 8.
- Recovery dependencies count a login email as a dependency too, since a password reset goes there. The mailbox behind an email is any email-type account signing in with that address. Its MFA decides the "Mailbox has no MFA" flag. With no such account, the flag reads "Mailbox not in vault".
- Accounts group by platform, falling back to the publisher until Phase 10 catalogs platforms.
- `dashboard_summary` arrives early, with only the counts accounts and identities can answer (accounts, main/alt, identities, missing MFA, favorites, recent) and an optional identity filter (`useIdentityFilter`, in memory, cleared by the lock reload). Phase 12 adds the health counts.
- Identity names are unique, case-insensitively. Identity `icon` is not used yet; the avatar is initials on the identity's color.

## Phase 9 notes

- **Settings > Purpose labels** lists every label in the order the account form and filters show them. The built-ins (Main, Competitive, Ranked, Casual, Alt, Creator, Testing, Work, Recovery, Other, seeded by V2) can be hidden, recolored and moved, but keep their name and can't be deleted; Rust refuses both, not just the UI. Labels you add can also be renamed and deleted. No migration: V1's `purpose_label` already had every column.
- **Hidden** means not offered for new picks. Accounts keep a hidden label and still show it. `purpose_list` now returns every label with `isHidden`, `color` and `accountCount` (archived accounts included). The form offers the visible ones plus the account's own; the filter menu offers the visible ones plus hidden ones that accounts still use or the current filter has. At least one label always stays visible (`invalid_input` on `lastVisible`).
- **Slugs** come from the name (`slug_of` in `service/purposes.rs`: lowercase ASCII letters and digits joined by hyphens, `custom` when there are none), get `-2`, `-3` on a collision, and never change, not even on a rename. The High-priority view and the dashboard's Main/Alt counts match on built-in slugs. Names are unique ignoring ASCII case, hidden labels included, and at most 40 characters.
- **Delete** needs a replacement when any account (archived too) uses the label: `purpose_delete(id, reassignTo)`, where the target must be another visible label. Moving the accounts, deleting the label and reindexing run in one transaction. Moving doesn't change an account's `updatedAt`, like assigning an identity. Your saved views that filter on the deleted label switch to the replacement, or drop it when nothing replaced it.
- **Rename** reindexes every account with the label, archived ones included, so search finds them by the new name only.
- **Colors** are the identity palette (`PurposeColor`), never a status color. `PurposeBadge` (a dot in the label's color, then the name) is how the account table, cards, compact list and account page show a purpose. A label without a color gets an outlined dot.
- **Reordering** is by Move up and Move down buttons, so it works from the keyboard; focus stays on the moved label. `purpose_reorder` takes every id in the new order and refuses anything else.
- **Not built-ins:** "Shared household" and "Smurf" are custom-only (ADR-0004); anyone who wants one can add it as a custom label. "Shared household" was still undecided when this phase landed and was settled in Phase 16.
- Not done in Phase 9: the identity page's account rows, the dashboard's recent accounts, sidebar favorites, Ctrl+K results and map nodes still show the purpose as plain text (they don't carry the purpose id, or fold it into a longer line). The UI is tested against mocked IPC and has not been driven in the running app.

## Phase 10 notes

- The built-in catalog (25 platforms, 19 games) is `crates/vaultair-core/catalog/default_catalog.json`. The V4 migration seeds it with `INSERT OR IGNORE` in the same transaction (`migrate.rs`, `CATALOG_SEEDS`), so an edited built-in or a user entry with the same name is kept. A future catalog update adds its version to `CATALOG_SEEDS`.
- Logos resolve by catalog ID from a bundled manifest, `crates/vaultair-core/catalog/logos.json`, with one record per built-in platform and game: a [Simple Icons](https://simpleicons.org) mark (`simple-icons`, CC0, pinned), a reviewed file under `src/assets/logos/` (none yet; each needs its source, its licence and the owner's sign-off recorded), or a deliberate monogram with the reason there's no logo. `npm run logos:build` generates `src/features/catalog/logos.generated.ts` from it, importing just the slugs named, so the rest of the set isn't bundled, and nothing is fetched at runtime. Because the lookup is by ID, a logo added later reaches existing vaults on the next app update; the `icon` slug stored in the vault is only a fallback. The marks remain their owners' trademarks and are used only to identify the service. Brands with no usable logo (Xbox, Nintendo, Microsoft, Blizzard games, Minecraft...) show initials in a tile tinted with the brand colour, where one is recorded; user-added entries show neutral initials. Logos too dark for the UI (under 3:1 against the card) are drawn in the text colour. `npm run logos:report`, `logos:suggest` and `logos:sheet` check coverage and help review; a test fails if the manifest misses a built-in or the generated module is stale. See [docs/logo-pipeline.md](docs/logo-pipeline.md).
- An account's mark: for a game account its game, otherwise its platform, preferring whichever has a logo; with neither, the initials of its publisher or title.
- A platform's `default_login_url` is used by "Open login page" only when the account has no login page of its own, and the detail row and confirm dialog both say it came from the catalog.
- The account list filters by platform, game (including accounts with a profile for that game) and publisher in Rust (`AccountFilter`). Phase 11 replaced this with the full filter language.
- Game profiles have their own search rows (`entity_type = 'game_profile'`). Renaming a platform or game reindexes the accounts and profiles that name it; deleting an account removes its profiles' rows before the cascade.
- Email providers (Gmail, Outlook.com, Proton Mail, iCloud Mail, Yahoo Mail, AOL Mail, Zoho Mail, Tuta, Fastmail, GMX, mail.com, Mail.ru, Yandex Mail, HEY, mailbox.org) are built-in platforms. An email account without a platform shows its address's provider (from the domain, `emailProvider` in `logos.ts`), and the form offers to set that platform. On a new account whose name, type and platform are still blank, typing a known provider's address fills them in (type Email, the provider's platform, its name and publisher) with an Undo; once the user has started the account, the address is treated as just its login. Purpose isn't inferred: a mailbox can be Main, Recovery or Creator, and the domain can't tell. A provider's mark is its platform's, found by the platform ID. Outlook, Yahoo, AOL, Fastmail and Yandex show brand-coloured initials: their owners had their marks removed from Simple Icons, so there's no freely licensed logo to bundle.
- Sensitive notes that look like they hold an email, username, password, backup codes or a security answer get a suggestion to move them into their own field, with the security trade-off stated. See [ADR-0006](docs/adr/0006-sensitive-notes-suggestions.md). V5 adds the flag column and seeds the new email providers.
- The account list has no Updated column. Its Status shows the activity instead: an active account turns **Stale** after 30 days without activity and **Dormant** after 90 (`STALE_AFTER_DAYS`, `DORMANT_AFTER_DAYS` in `labels.ts`). Activity is the latest of an edit, "Mark verified", and using the password from Vaultair (reveal or copy; V6 adds `account.last_used_at`). It's worked out for display only: the saved status never changes by itself, and a status the user set wins. Phase 12's dormant health rule should use the same rule. The freed column holds quick-copy buttons for the username (or email) and password.
- Hiding catalog entries (the plan's data-model notes mention it) isn't done yet; unused entries sit behind a toggle on the Games and Platforms pages.

## Phase 11 notes

- **Search** runs on the FTS5 trigram index inside SQLCipher (`crates/vaultair-core/src/search/`). A word of 3+ characters matches anywhere in a field, so "sn1p" finds `xX_Sn1per`; shorter words fall back to a prefix match on title, username and player ID. Every word must match. Words are quoted before they reach FTS5, so its operators are plain text. Ranking is `bm25` weighted title > username/email > player ID > game/platform > the rest, with archived results last.
- **Nothing secret is indexed.** Passwords, sensitive notes, secret custom fields, TOTP keys, backup codes, recovery instructions and fingerprints never reach `search_index`; `tests/search.rs` plants `CANARY7F3A` in each and checks that no search finds it and no index cell holds it.
- **The filter language** (`search::filters::AccountFilter`, versioned by `ViewSpec { v: 1 }`) is what the chips, the text box and saved views send. Rust validates it (unknown fields, bad values and oversized lists are rejected) and compiles it to fixed SQL fragments; every user value is a bound parameter, and lists are bound as one JSON array read with `json_each`. Stale and Dormant are worked out in SQL with the same 30/90-day rule as `labels.ts` (`STALE_AFTER_DAYS`, `DORMANT_AFTER_DAYS` exist in both; keep them equal).
- **Saved views**: V7 seeds the built-ins (Main, Alts, High-priority, Missing MFA, Missing recovery codes, Uses primary email, Recently updated, Dormant, Archived). Built-ins can't be edited or deleted; a stored filter that no longer validates is skipped, not fatal. The sidebar's Archived entry is the Archived view. High-priority is favorites plus the Main and Recovery purposes for now; accounts with high-severity health issues join it in Phase 12. "Missing recovery codes" means MFA is on and no backup codes are left.
- **Bulk actions** (tag, archive/restore, delete) are one transaction each and all-or-nothing: an id that no longer exists fails the whole action. Bulk delete needs "DELETE <n> ACCOUNTS" (or "DELETE 1 ACCOUNT"), typed by the user and checked again in Rust against the real count.
- **Index health**: `vault_integrity_check` now reports `searchIndexOk` (one row per account, identity and game profile, no orphans). `search_rebuild_index` rewrites it from the tables; a test checks a rebuild matches the incremental rows exactly.
- **Performance** (release build, 5,000 accounts): p95 37 ms across search and filtered lists; the worst case, a word in every row, is about 37 ms. Re-measure with `cargo test --release -p vaultair-core --test search -- --ignored --nocapture`.
- **Every command must be allowed.** A new command needs its name in `src-tauri/build.rs` and `allow-<name>` in `capabilities/main.json`, or Tauri rejects it at runtime. `ipc.rs`'s `every_command_is_allowed` test now checks both against the bindings (the live run below caught this; the mocked frontend tests couldn't).
- Driven end to end in the real webview (2026-09-26, demo vault): Ctrl+K found `NightOwl#2231` from `owl#2` and opened its account; text search, an MFA chip (by mouse), the High-priority view, cards and compact layouts, shift-range selection, bulk tag then finding by the new tag, bulk archive, and bulk delete (disabled for a wrong count or lowercase phrase; Rust rejects a wrong phrase on its own). Afterwards `searchIndexOk` was true and "password" and "answer" found nothing.
- **The list** renders only the rows on screen (`@tanstack/react-virtual`), in table, card or compact layout. The view, filters, sort and layout are remembered in memory per list for the session (`listState.ts`), never on disk. Ctrl+K searches the vault, opens saved views, and jumps to pages.

## Phase 12 notes

- **Five checks**, all local, over active accounts only. Archived accounts are left out of every count and list.
  - **Weak** (high): password strength 0 or 1. No saved password is not weak. Score 2 is not weak.
  - **Reused** (high): the password fingerprint matches another active account. The group is counted across the whole vault; an identity filter only chooses which accounts are listed. A match that exists only on an archived account does not count. The screen says how many other accounts share it. The fingerprint never leaves Rust, and it is never selected into a result.
  - **Missing MFA** (medium): no MFA method is turned on.
  - **Missing recovery codes** (low): MFA is on and no backup codes are left.
  - **Dormant** (info): saved status dormant, or active with no activity for 90 days. Activity is the same latest-of edit, "Mark verified", and password use as the account list (`DORMANT_AFTER_DAYS` in `health/thresholds.rs` and `labels.ts`). Mark verified clears an activity-based dormant issue. A status the user set to dormant stays until they change it.
- **High-priority** saved view is favorites, the Main and Recovery purposes, and accounts with a weak or reused password.
- **Fix** opens the account form for a weak or reused password, the account's MFA section for missing MFA or missing codes, and the account page for a dormant account.
- The dashboard's health counts and "Needs attention" list (five issues, highest severity first) come from the same rules as Security Health. Both pages share the session identity filter.

## Phase 13 notes

- **One command**, `graph_query({ focus, depth, limit })`. The focus is an identity, an account, a contact (an email or a phone), a platform or a game. Rust returns what is within 2 steps, at most 300 nodes, with `truncated` set when more was in reach. A deeper or larger request is `invalid_input`. An unknown focus, or an archived account, is `not_found`.
- **Nodes**: identity, email, recovery method (a phone), account, platform, game and MFA method (only methods that are turned on). Archived accounts are left out, with anything only they connect to. A node carries an id, a label, an icon slug, an identity colour and an account's purpose name. The builder (`crates/vaultair-core/src/graph/builder.rs`) selects no `*_enc` column, fingerprint or strength score, and `tests/graph.rs` plants `CANARY7F3A` in a password, sensitive notes, a secret custom field, recovery instructions and backup codes and checks it never reaches the graph.
- **Edges are derived, not entered**: assigned (identity to account), primary email, recovery email and phone (identity to contact, matched by value, since several identities can name one address), sign-in email, recovery email and recovery phone (contact to account), platform, game (the account's own, or a game profile's), MFA, and linked launcher or console (from a game profile's links). The `platform_connection` table from V1 is still unused: nothing writes it, so the map doesn't read it yet.
- **The tree** is worked out in Rust (`parent` and `parentEdge` on each node), so the map and the list can't disagree. Each node hangs under its best link to a node one step nearer. Two exceptions make it read like the spec's example: an account that is only "assigned" moves under the email it signs in with, and a linked account moves under its launcher or console.
- **Two views of the same data.** The map is laid out left to right by dagre from the tree, focus at the left. The list nests the same tree, writes the relationship before each record, and lists links the nesting can't show under the record they lead to. An "assigned" link is left out of both when the nesting already says it (identity, its email, the account). The list is the default under reduced motion or above 80 nodes (`LIST_DEFAULT_ABOVE`).
- **Clicking** an identity, account or MFA method opens it (an MFA method opens its account's MFA section). An email, phone, platform or game has no page of its own, so clicking it moves the map onto it. The list also has a "Focus" button on identities and accounts.
- **No graph library draws the map.** The plan named `@xyflow/react`. It depends on `d3-color`, which assigns to a prototype's `constructor` as it loads, and `freezePrototype: true` makes that throw, so the app would not start (the mocked frontend tests passed; the live run caught it). The canvas is our own (`GraphCanvas.tsx`): positioned buttons over an SVG, native scrolling to pan, drag on the background, and zoom buttons. `@dagrejs/dagre` loads fine under the frozen prototype. Check any future library that pulls in d3 the same way, in the real webview.
- **Hidden emails**: with the privacy setting on, email nodes and the focus picker read "Hidden email 1", "Hidden email 2" and so on (numbered in contact order, so they stay the same between views).
- **All or Focused** (added 2026-10-06): a second segmented control switches the map between one record's surroundings (Focused, as before, and the default) and the whole vault (All). All is `graph_overview({ limit })`: a tree under every identity, walked from all of them at once so a shared record hangs under the nearest, then a tree under each email and each account no identity reaches; platforms and games no active account uses are left out; at most 300 nodes, with `truncated` set beyond that. `Graph.focus` is null for it. The All map opens at full size from its top-left corner and scrolls, where a focused map opens fitted; the list shows one tree after another. Choosing an email, phone, platform or game there (or "Focus" on a record in the list) switches back to Focused on it.
- **The focus picker** is the app's own (`FocusPicker.tsx`, a popover over the command list): a button showing the current record, a search field that matches names, and the records grouped by kind. It replaced the native select, whose open list the webview drew in system colours.
- **Prospective accounts** (added 2026-10-06): an email that active accounts sign in or recover with, while no email-type account in the vault signs in with it, gets a "Suggested account" node hanging off the email on its own line style (dots in pairs, "Suggested, not in vault" in the legend). An archived mailbox account counts as having one. On the map the node opens a popover, and in the list its row ends with the same three actions: **Add account** creates an email account for the address straight away (named and placed by its provider, or named after the domain, with no password yet), **Edit first** opens `/accounts/new?mailbox=<contact id>` filled in the same way, and **Discard** hides the suggestion, with Undo in the toast. Discarding is `graph_prospect_set_dismissed({ contactId, dismissed })`, stored in `contact_point.mailbox_dismissed_at` (V8). The node's mark is that provider's catalog logo, resolved by platform id from the label on screen (`CatalogLogo`'s `id`); a hidden address is not a domain, so it stays a plus. Not yet driven in the real webview.
- Driven in the real webview (2026-10-05, demo vault): the map for an identity, an email, an account and a platform, the list, and a node click opening its account, with no console errors.
- Not done in Phase 13: a "show on map" link from the account and identity pages (the focus picker and Ctrl+K reach the map), and thinning dense maps. A shared email at 2 steps touches most of the demo vault, so that map is busy; the list or a narrower focus is the calmer view.

## Phase 14 notes

- **A backup** is one `<Vault name>-YYYYMMDD-HHMMSS.vaultair-backup` file (UTC): the vault's header, its SQLCipher database as it is on disk, and an HMAC-SHA256 over the whole file keyed from the vault's own key (`crates/vaultair-core/src/backup/`, format in `docs/vault-format.md` Â§11, guide in `docs/backup-restore.md`). No plaintext is written anywhere, and `tests/backup.rs` checks the canaries are absent from the file.
- **Not the online backup API.** The plan called for it, but SQLCipher refuses it on encrypted databases. The database file is copied byte for byte under a read transaction instead, which keeps every page and its HMAC as they are.
- **Back up now** writes to a `.tmp`, renames, then reads the file back (MAC, then every database page) before reporting success. A backup that doesn't read back is deleted. An existing backup is never overwritten.
- **Check a backup** works for the open vault's own backups. Another vault's backup can only be checked by restoring it, because the MAC key comes from that vault's key.
- **Restore** is on the lock screen and in Settings. It always makes a new vault folder (new or empty, like create), takes the master password the backup was made with, runs every check before the header is written, and leaves nothing behind on failure. The restored vault is named after its folder and added to the recent vaults. It keeps the original's vault id.
- **Settings > Backups** holds the backup folder (refused inside the vault's own folder, warned about in a cloud-synced one), the last successful backup and whether the latest attempt failed. These live in `vault_settings`, so they travel with the vault. "Backup due" shows there and on the dashboard with no backup or one 30 days old (`REMINDER_AFTER_DAYS`); never for a demo vault.
- New error codes: `invalid_backup`, `backup_other_vault`, `backup_destination`. `vaultair-platform` gains `pick_file` beside `pick_folder`.
- The checked copy of a backup's database goes to `%LOCALAPPDATA%\Vaultair\tmp\` (still encrypted) and is deleted afterwards (`docs/local-data-storage.md`).
- Not done in Phase 14: scheduled backups, the automatic backup before a schema migration (plan Â§2.4, needed once migrations ship to released vaults), and the full Backup tab layout, which arrives with the rest of Settings in Phase 15. The UI is tested against mocked IPC; the system file picker and a real backup and restore have not been driven in the running app yet.

## Phase 15 notes

- **Settings** is one page in sections: General, Security, Privacy, Backups, Catalog and About (`src/features/settings/`). Phase 9's purpose labels join it after Backups.
- **Where each setting lives.** Lock and clipboard timings are in the vault's own `vault_settings` (`service/settings.rs`), so they travel with the vault and a backup. They are applied on every unlock and create, so a vault never runs with the previous one's. Screenshot protection and email masking stay in `config.json`, because they apply while locked. Every change applies at once; nothing needs a restart. The `VAULTAIR_DEV_*` overrides still win in debug builds.
- **Bounds**, checked in Rust: auto-lock 1â€“120 minutes or never, clipboard clear 10â€“300 seconds ("never" isn't offered), reveal auto-hide 5â€“300 seconds. "Never" for auto-lock needs a confirm. A stored value this build doesn't accept reads as its default.
- **Vault name and colour.** Renaming changes the display name in `vault_meta`, not the folder: the folder is open and locked while the vault is, and the lock screen lists vaults by folder because `config.json` never holds names from inside a vault. The name follows the same rules as a new vault's, since it names backup files. The colour uses the identity palette, shown on the sidebar avatar. A vault icon (the plan lists one) isn't offered, as with identities.
- **Change master password and Strengthen key derivation** both re-wrap the same data key (`vault/rekey.rs`, format in `docs/vault-format.md` Â§8). Argon2 runs outside the session lock; only the header write holds it. The header is replaced with `.prev` kept just until the new header reads back, so a crash at any point leaves a header that opens with the old or the new password. Tests stop the write after each step and check which password opens. The vault stays unlocked, and old backups keep the old password (the dialog says so). Strengthen measures this PC first (`vault_kdf_check`) and only offers more memory or passes; Rust refuses a lower KDF.
- **Privacy** shows the promises from `docs/privacy-statement-draft.md` and the logs folder, with "Open logs folder" (Explorer on Vaultair's own folder only; `vaultair-platform::windows::open_folder`).
- New commands: `settings_get`, `settings_update`, `vault_profile_update`, `vault_change_password`, `vault_kdf_check`, `vault_strengthen_kdf`, `logs_folder`, `logs_open`. The plan's `app_config_*` already exist as `capture_policy_set` and `hide_emails_set`.
- Not done in Phase 15: the purpose labels section (Phase 9), the Windows Hello and tray settings (Phase 15b), and remembering the generator's options. The UI is tested against mocked IPC; the change-password and strengthen flows haven't been driven in the running app yet.

## Phase 15b notes

- **Windows Hello unlock** is opt-in, per vault and per PC (Settings > Security > Windows Hello), decided in [ADR-0005](docs/adr/0005-quick-unlock.md). Turning it on takes the master password and one Hello prompt. After that the lock screen offers "Unlock with Windows Hello". It never opens the Hello prompt by itself: you click the button, and "Use master password" is beside it.
- **The master password is still asked for** after Windows restarts, more than 7 days after it was last typed, after 3 Hello attempts in a row that failed or were cancelled, after the password or KDF changes, to turn Hello unlock on or off, and to set auto-lock to "never" while it is on. The lock screen says which rule applies. Change password, Strengthen key derivation and Restore already took it.
- **How it works.** Hello holds a key named `Vaultair-<vault_id>` that never leaves it. Its signature over a random challenge is the same every time; HKDF over the signature gives the key that wraps the vault's data key. The wrapped key is the device slot, `%LOCALAPPDATA%\Vaultair\devices\<vault_id>.qu`, wrapped again with DPAPI. It is not in `vault.vhdr`, so the vault format stays v1 and nothing travels with the vault or its backups. Format: `docs/vault-format.md` Â§12.
- **Where the code is.** `vaultair-core`: `vault/device_slot.rs` (format and crypto), `service/quick_unlock.rs` (the rules and the enable, unlock and forget steps, against a `QuickUnlockDevice` port), and `open_vault` split so a vault can open from keys (`open_vault_with_keys`). `vaultair-platform`: `QuickUnlockKey`, `DeviceProtection` and `SystemInfo`, with `windows/{hello,dpapi,sysinfo}.rs` and fakes. `src-tauri`: `quick_unlock.rs` (the adapter) and `commands/quick_unlock.rs`.
- **A password or KDF change turns it off**: the slot is bound to the header, and Vaultair deletes the slot and the Hello key. Deleting the key is the real revocation, since the data key itself doesn't change. The dialogs say so, and you turn it on again afterwards.
- **No TPM** is allowed with a warning in the dialog. The TPM is detected with `Tbsi_GetDeviceInfo`, not Hello attestation (the spike showed a working firmware TPM reporting `NotSupported`).
- **Keep running in the tray** (Settings > Security, saved in `config.json`): closing the window hides it and **locks the vault**, as quitting did, and the tray icon has Open, Lock and Quit. A second launch brings the hidden window back.
- New commands: `quick_unlock_status`, `quick_unlock_enable`, `quick_unlock_unlock`, `quick_unlock_forget`, `quick_unlock_offer`, `quick_unlock_offer_dismiss`, `quick_unlock_enable_now`, `tray_set`. `settings_update` takes an optional `password`. New error codes: `quick_unlock_unavailable`, `quick_unlock_password_required`, `quick_unlock_cancelled`, `quick_unlock_failed`.
- **Known limits** (in `docs/threat-model.md` and `docs/security-assumptions.md`): the restart, 7-day and 3-attempt rules are enforced by Vaultair, not by the key; with Windows Fast Startup only "Restart" resets the uptime the restart rule reads; the failure count in the slot has no MAC.
- Driven in the real webview (2026-10-06, scratch `LOCALAPPDATA`): the app starts; `quick_unlock_status` reports this PC's Hello and TPM; a wrong password is refused before any Hello prompt; the Windows Hello section and the tray switch render; with the tray setting on, closing hides the window, locks the vault (`reason=Tray`) and keeps the process.
- **Found on first use (owner, 2026-10-06), fixed, and rechecked by the owner on 2026-10-07:** the Hello prompt opened behind the Vaultair window, and turning it on asked for the PIN twice. The prompt has no owner-window option, so while a request waits `windows/hello.rs` now finds the "Windows Security" prompt and brings it forward (topmost, then foreground, then one Alt-key nudge if Windows refuses), for at most 5 seconds. Turning it on now signs with the credential the create call returns, in the same approval; opening the key again by name was what asked a second time.
- **Checked by hand with real Windows Hello (owner, 2026-10-07):** the prompt opens in front of the window, and denying it three times shows the warning and asks for the master password. The owner reported the other checks on the list as good: unlock after relock (idle, Win+L, sleep) and after reopening the app, the password asked for after a Windows restart, a password change turning it off, and the tray menu. The automated tests still use in-memory Hello; `cargo test -p vaultair-platform -- --ignored real_hello` (3 prompts) is the one that uses the real thing.
- **The offer** (added 2026-10-07, merged as [PR #23](https://github.com/bubb4rd/vaultair/pull/23)): just after the master password opens a vault that doesn't have Hello unlock, on a PC where Hello is set up, a small card appears in the bottom-right corner (`src/features/shell/HelloOffer.tsx`). **Turn on** goes straight to the Windows Hello prompt, with no password field: the password was typed a moment ago, so Rust accepts it for 5 minutes (`PASSWORD_FRESH_SECS`; `quick_unlock_enable_now`). After that, or in a session Hello opened, the same button opens the usual dialog and asks for it. **Not now** hides the card until Vaultair restarts; **Don't ask again** hides it for good on this PC (`helloOfferDismissed` in `config.json`). Settings > Security still turns it on either way, with the password. No offer for a demo vault. This amends ADR-0005 decision 4, and the trade-off is in `docs/threat-model.md`. Automated tests use mocked IPC and in-memory Hello; **checked by hand with real Windows Hello (owner, 2026-10-07):** the card after a password unlock, one-prompt **Turn on**, **Not now**, **Don't ask again**, password fallback when the password is no longer fresh or the session was opened with Hello, and no offer on the demo vault.

## Phase 16 notes

- **Documentation pass.** Every doc in the plan's Â§7 table was checked against the code and corrected where it had drifted. `docs/future-extension-sync-checklist.md` is new.
- **Decided in this phase (ADR-0004):** "Shared household" is not a built-in purpose label, and code signing follows decision 14 (unsigned for the private beta, a certificate before any public release).
- **No installer yet.** `tauri.conf.json` has an NSIS bundle section, but no installer has been built or tested, so there are no install instructions. Run Vaultair from a source build. The section sets `webviewInstallMode` to `offlineInstaller` (project owner, 2026-10-07): the installer will carry Microsoft's WebView2 runtime installer inside it, about 130 MB, so installing makes no network connection even on a PC without WebView2. A bootstrapper mode would download it at install time; the release-config check refuses one. The bundler fetches that runtime installer on the build machine, and an installed WebView2 is updated by Microsoft's updater, not by Vaultair.
- **Decided by the project owner, 2026-10-07:** a shown secret is copied only with its Copy button and stays non-selectable text (ADR-0004, "As built"); and the repository is public. `SECURITY.md` names GitHub private vulnerability reporting as the way to report; that route needs the repository to be public with private vulnerability reporting turned on, and both were done on 2026-10-07.
- **Secret-flow audit and its review** (`docs/threat-model.md`, `docs/security-assumptions.md`). Closed by it: the logs hold no path from your PC or the build PC (a framework error is logged as its kind, a crash by its place in the source); a copy, cut or drag whose selection touches a shown secret is intercepted and sent through the protected clipboard path or dropped (a backstop: shown secrets are not selectable text, and this is tested in the test DOM only); a shown backup code hides itself like other revealed values; every command's return type is held in a reviewed list (`src-tauri/ipc-surface.snap`; update it with `VAULTAIR_UPDATE_IPC_SURFACE=1 cargo test -p vaultair the_command_surface`). Left as documented limits: a hand copy out of an editable field is an ordinary Windows copy, backup file names show the vault's name, and idle lock can come up to 15 s late.
- **Still open from earlier phases** (each checked against the code in this pass):
  - The automatic backup before a schema migration (plan Â§2.4). `db/migrate.rs` runs migrations without one. It is needed once migrations ship to released vaults.
  - Scheduled backups. Backups are made when you press the button.
  - Clearing a copied value after a crash (Phase 5). A crash or a killed process before the timeout leaves the value on the clipboard.
  - The lint rule against putting reveal results in query cache keys (Phase 7).
  - The `platform_connection` table from V1 is still unused: nothing writes or reads it.
  - A manual check for the owner, in the running app: with a secret shown, try to select it with the mouse, with a double and a triple click and with Ctrl+A, then press Ctrl+C and look at Win+V. Do it on each guarded field (password, hidden custom field, setup key, recovery steps, sensitive notes, a backup code, the TOTP code) and on the generator. Expected: nothing selects; if something does, the copy is either protected like the Copy button or nothing is copied.
  - The demo-vault step of onboarding still says "Sample accounts to explore arrive in a later version" (`src/features/onboarding/steps.tsx`), though `vault_create_demo` seeds a demo vault with sample accounts (`vaultair_core::demo`).

## Phase 17: Passkeys and login credentials (scoped)

Not started. This is its own phase, after the MVP (Phases 0â€“16). Phase 7 owns account records, passwords, and MFA metadata, including the existing `hardware_key` method. This phase owns passkeys. It starts only once an account row exists to attach a credential to.

The product spec lists "Passkey management exploration" on the post-MVP roadmap, and hardware keys plus desktop autofill later still. ADR-0004 forbids autofill and auto-login. Windows Hello vault unlock is separate: ADR-0005 adds it in Phase 15b. This phase is the concrete cut of that exploration. It does not reopen Phase 7.

A passkey is a FIDO2/WebAuthn credential: a relying-party id, a credential id, and a private key that signs a challenge. Two different jobs use that shape. They ship as two cuts inside this phase.

**Cut A â€” account login credentials.** Vaultair stores passkeys for the user's own sites and apps, and can create or assert one when Windows asks, while the vault is unlocked and the user approves that site. This is the login support.

**Cut B â€” vault unlock.** A second header key slot, `kind: "windows-hello"`, wraps the same DEK. Windows Hello (PIN or biometric) unwraps it. The master password still creates the vault, still restores a backup, and still changes the password. Hello never replaces it. The slot is wiped on password change and on DEK rotation, and a reboot requires the master password again (the quick-unlock rules already in the implementation plan, Â§5). Since this was written, Phase 15b shipped Windows Hello unlock as a device slot outside the header ([ADR-0005](docs/adr/0005-quick-unlock.md), which keeps `key_slots` for slots that travel with the vault), so Cut B as written is superseded unless the owner reopens it.

### How a site login works

Windows 11 can hand WebAuthn create/get to a third-party passkey manager. The APIs are the WebAuthn Plugin APIs (`IPluginAuthenticator`, `WebAuthNPluginAddAuthenticator`, `WebAuthNPluginAuthenticatorAddCredentials`, `WebAuthNPluginPerformUserVerification`). Microsoft's passkey-manager sample targets Windows 11 24H2 build 26100.6725+ and 25H2 build 26200.6725+. The public rollout of third-party managers was the November 2025 update. Docs: [WebAuthn APIs](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis), [Passkey Manager sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/passkeymanager/).

Vaultair registers as that plugin from `vaultair-platform` (Win32 only). Windows keeps credential *metadata* so a browser or app can offer "Vaultair" at a passkey prompt. The private key stays in the SQLCipher file, inside a field envelope, same as a password. On create or get:

1. The vault must be unlocked. A locked vault cancels the operation.
2. Windows Hello performs user verification (`WebAuthNPluginPerformUserVerification`). Vaultair does not invent its own biometric prompt.
3. Vaultair shows the relying party and the account title and waits for a confirm. A mismatch between the requested rp id and the stored credential is a refusal.
4. Rust signs the challenge and returns the assertion. The private key is not copied, revealed, logged, or indexed.

On builds that lack the plugin APIs, Cut A still stores a passkey the user created on a supported machine, and the account screen shows it. That machine cannot complete a site login until the OS is new enough. Detect the build; do not pretend the plugin loaded.

Existing passkeys cannot be imported. Platform and hardware authenticators do not export the private key. A YubiKey or a Windows Hello passkey made outside Vaultair stays an MFA note (`hardware_key` from Phase 7): label, where it lives, which account. Vaultair only holds passkeys it created through the plugin.

Most game launchers do not speak WebAuthn. Steam, Battle.net, and console accounts stay username, password, and TOTP. Passkeys attach to accounts that publish a relying-party id (Microsoft accounts, Discord, email, and other websites). The account screen says so when the platform has no passkey login.

### Data

New table `account_passkey`, cascaded with the account:

- `id`, `account_id`, `rp_id`, `credential_id`, `user_handle`
- `private_key_enc` â€” field envelope. Never indexed, never in a DTO, never in a log.
- `sign_count`, `created_at`, `last_used_at`, display label
- AAGUID fixed to Vaultair's plugin authenticator

List DTOs return rp id, label, created, and last used. There is no reveal command. The sign counter is stored and checked; a counter that moves backwards warns and does not silently accept the clone.

Cut B is a header change. Today's reader requires exactly one `password` slot and `deny_unknown_fields`, so a second slot makes current builds fail to open the file. Cut B bumps `format_version`, writes a pre-migration backup first, and older builds report `VaultTooNew`. Cut A is rows in the encrypted database and does not bump the header, so it can land first.

### Out of this phase

- Phase 7 account CRUD, password fields, and TOTP. The Cloud Agent's scope.
- A browser extension, password autofill, and filling credentials into a game client.
- Sign-in with no one at the keyboard. Every assertion is user-present.
- Any network call. `deny.toml` stays as it is. The browser talks to the site; Vaultair only signs.
- Syncing passkeys to a phone, and creating or restoring a vault with Hello alone.
- Acting as a roaming authenticator or speaking CTAP to a security key.

### Acceptance

- On a supported Windows 11 build, a test site can create a passkey into an unlocked vault and sign in again after a lock and unlock, with Hello and an in-app confirm both required.
- The private key is absent from list DTOs, tracing, and the search index (same canary rule as passwords).
- rp id mismatch, locked vault, and Hello cancel each fail closed.
- A format v1 vault still opens. A v2 header with a Hello slot round-trips, and a pre-Cut-B build rejects it as too new.
- Removing the plugin registration leaves the vault usable with the master password.
- `npm run tauri dev` launches and the suite passes on a machine without the plugin APIs.

## Third-party content

Settings > About lists these too (`src/features/settings/About.tsx`); keep the two in step.

- Platform and game logos come from [Simple Icons](https://simpleicons.org) (CC0). The marks remain their owners' trademarks.
- The database is [SQLCipher](https://www.zetetic.net/sqlcipher/) by Zetetic (BSD-style licence).
- The interface typeface is [Geist](https://vercel.com/font) by Vercel (SIL Open Font License 1.1).
- The relationship map's layout uses [dagre](https://github.com/dagrejs/dagre) (`@dagrejs/dagre`, MIT, pinned).
- Passphrases use the [EFF large wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) by the Electronic Frontier Foundation, licensed [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/). It's embedded unmodified at `crates/vaultair-core/src/generator/eff_large_wordlist.txt`.
