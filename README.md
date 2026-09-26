# Vaultair

A local-first, encrypted Windows workspace for people who manage several gaming and online identities: accounts, identities, recovery codes, MFA and how they all connect, in one vault on your own disk. No cloud account, no network.

> **Status:** Phase 12 (health checks). Phase 9 (purpose labels) is deferred and still needed before release. Next: Phase 13, the relationship map. Phase 17 (passkeys) is scoped below and is not part of the MVP.
> Proprietary. All rights reserved.

## Docs

| Doc | What it is |
|---|---|
| [`docs/product-spec.md`](docs/product-spec.md) | Original product spec |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Architecture, crypto design, schema, and the phased build order (Phases 0–16) |
| [`docs/design-system.md`](docs/design-system.md) | Design read, tokens, contrast, status system, voice |
| [`docs/architecture.md`](docs/architecture.md) | Layers, security baseline, manual release checks |
| [`docs/vault-format.md`](docs/vault-format.md) | Byte-level vault format, key hierarchy, error classes |
| [`docs/security-assumptions.md`](docs/security-assumptions.md) | What the crypto relies on, and its known limits |
| [`docs/local-data-storage.md`](docs/local-data-storage.md) | Every file Vaultair writes |
| [`docs/privacy-statement-draft.md`](docs/privacy-statement-draft.md) | Privacy promises; source for onboarding and settings copy |
| [`docs/forgot-master-password.md`](docs/forgot-master-password.md) | Why there is no recovery, and what to do instead |
| [`docs/threat-model.md`](docs/threat-model.md) | What Vaultair does and does not protect against (draft) |
| [`docs/adr/`](docs/adr) | Architecture decision records |

## Prerequisites (Windows)

| Tool | Notes |
|---|---|
| Rust stable, `x86_64-pc-windows-msvc` | via rustup |
| MSVC Build Tools (VS 2022, "Desktop development with C++") | |
| Node.js LTS + npm | |
| WebView2 runtime | ships with Windows 10/11 |
| **Strawberry Perl** | `winget install StrawberryPerl.StrawberryPerl`. Required to build vendored OpenSSL for SQLCipher. Git's bundled MSYS Perl does **not** work; make sure `C:\Strawberry\perl\bin` comes before Git's `usr\bin` on `PATH` when building. |

## Development

```powershell
npm install
npm run tauri dev              # app with hot reload
cargo test --workspace         # Rust tests (also regenerates src/ipc/bindings.ts)
npm test -- --run              # frontend tests
npm run lint; npm run typecheck
npm run check:release-config
cargo deny check               # needs: cargo install cargo-deny --locked
npx tauri build --no-bundle    # release binary at target\release\vaultair.exe
```

Every phase must leave `npm run tauri dev` launching and all tests passing. After adding or changing a command, run `cargo test -p vaultair` and commit the regenerated `src/ipc/bindings.ts`; CI fails if it's stale.

CI (`.github/workflows/ci.yml`) runs fmt, clippy (`-D warnings`), tests, the bindings check, `cargo-deny` (licenses, bans, and RustSec advisories) for Rust, plus lint, typecheck, tests and the release-config check for the frontend. `deny.toml` bans network client crates to keep the no-network promise checkable.

Vault files (`*.vdb`, `*.vhdr`, `*.vaultair-backup`) must never be committed. `.gitignore` and a CI check enforce this.

## Design tooling (Claude Code)

- `design-taste-frontend` decides direction (onboarding, lock screen, empty states, overall feel). It lives in `.agents/skills/` and needs a junction so Claude Code finds it:
  ```powershell
  New-Item -ItemType Junction -Path .claude\skills\design-taste-frontend -Target .agents\skills\design-taste-frontend
  ```
- `ui-ux-pro-max` (`.claude/skills/`) handles implementation: palettes, type, components, UX checks, dashboards and tables.
- The inspo MCP provides visual references.

## Phase 0 notes

- **SQLCipher build spike (2026-09-23): passed.** `rusqlite 0.37` + `bundled-sqlcipher-vendored-openssl` built on Windows/MSVC with Strawberry Perl; NASM was not needed. It produced SQLCipher 4.6.1 (OpenSSL 3.6). Verified: no plaintext on disk, a wrong raw key is rejected, FTS5 works inside the encrypted DB. A cold build takes about 8 min (OpenSSL), so the CI cache matters.
- **Phase 3 note:** on a wrong key, SQLCipher logs `hmac check failed` to stderr. Done in Phase 3: `PRAGMA cipher_log_level = NONE` is set on every open.
- **Building SQLCipher locally:** `.cargo/config.toml` points `openssl-src` at `C:/Strawberry/perl/bin/perl.exe`, so builds work from any shell.

## Phase 3 notes

- Unlock at calibrated parameters: **0.89 s** at Argon2id 512 MiB, t=3, p=4 on the dev machine (target ≤ 1.5 s). Re-measure with `cargo test --release -p vaultair-core --test vault_integration -- --ignored unlock_time --nocapture`.

## Phase 4 notes

- Driven end to end in the real webview (2026-09-24): onboarding, create, Ctrl+L lock, wrong password, unlock, force-kill and restart, unlock again, lock from the sidebar. Create (calibration + Argon2 + SQLCipher) took 1.1 s, unlock 0.8 s, in a debug build.
- To drive the app from a script: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` before `npm run tauri dev` and attach with Playwright `chromium.connectOverCDP`. Point `LOCALAPPDATA` at a scratch folder so test vaults and `config.json` don't land in your real profile.
- No `tauri-plugin-dialog` (it pulls in the banned `tauri-plugin-fs`); the folder picker is native, in `vaultair-platform`.
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

- Generator lives in `vaultair-core::generator`: OS randomness (`getrandom`), an unbiased index sampler (rejects the uneven tail instead of `x % n`), and "every selected type appears" by redrawing the whole password, never by planting characters. Entropy is exact: inclusion–exclusion over the required types for passwords, `words × log2(7776)` (+ `log2(10 × words)` with a number) for passphrases. zxcvbn's 0–4 score is shown alongside.
- Symbols are ASCII punctuation minus quotes, backtick, backslash, pipe and space (`!#$%&()*+,-./:;<=>?@[]^_{}~`). "Avoid look-alike characters" removes `Il1O0o`; "Leave out characters" takes any extra set. Leaving out every character of a selected type is an `invalid_input` error on `exclude`, shown on the field.
- Copying uses `clipboard_copy_plain` (auto-clear, kept out of Win+V history). Options are remembered in memory only until Settings arrive in Phase 15; a lock resets them.
- `GeneratorPopover` (compact, "Use password") is built and tested for the Phase 7 account form; nothing mounts it yet.
- Uniformity check (slow, ignored by default): `cargo test --release -p vaultair-core characters_are_uniform -- --ignored`. zxcvbn now builds at `opt-level = 3` in dev too, which took the core tests from 43 s to 4 s.

## Phase 7 notes

- Not done in Phase 7: the lint rule against putting reveal results in query cache keys (plan §Phase 7 risks). Every reveal (`SecretField`, `AccountForm`, `MfaSection`, the TOTP code) keeps the value in component state today, but nothing enforces it. The rule is `no-restricted-syntax` entries in `eslint.config.js` flagging `secrets.reveal` / `mfa.totpCode` inside `queryKey`/`queryFn`/`mutationKey`, `useQuery`/`useQueries`/`queryOptions`, or `setQueryData`/`fetchQuery`/`prefetchQuery`.

## Phase 8 notes

- Contact points are derived, not edited: an account save upserts its login email, recovery email and recovery phone, and an identity save upserts its primary email, recovery email and phone. `contact_point.value_normalized` uses `normalize_contact` (trim + ASCII lowercase, the same as SQLite's `lower()`), backed by the `UNIQUE (kind, value_normalized)` constraint. Unused contact points are pruned in the same transaction. So the plan's `contact_point_*` commands are just `contact_point_list` (form suggestions). No upsert or delete command exists, because nothing in the UI needs one.
- V3 adds `contact_point.value_display` and backfills login-email contact points for accounts saved before Phase 8.
- Recovery dependencies count a login email as a dependency too, since a password reset goes there. The mailbox behind an email is any email-type account signing in with that address. Its MFA decides the "Mailbox has no MFA" flag. With no such account, the flag reads "Mailbox not in vault".
- Accounts group by platform, falling back to the publisher until Phase 10 catalogs platforms.
- `dashboard_summary` arrives early, with only the counts accounts and identities can answer (accounts, main/alt, identities, missing MFA, favorites, recent) and an optional identity filter (`useIdentityFilter`, in memory, cleared by the lock reload). Phase 12 adds the health counts.
- Identity names are unique, case-insensitively. Identity `icon` is not used yet; the avatar is initials on the identity's color.

## Phase 10 notes

- The built-in catalog (25 platforms, 19 games) is `crates/vaultair-core/catalog/default_catalog.json`. The V4 migration seeds it with `INSERT OR IGNORE` in the same transaction (`migrate.rs`, `CATALOG_SEEDS`), so an edited built-in or a user entry with the same name is kept. A future catalog update adds its version to `CATALOG_SEEDS`.
- Logos come from [Simple Icons](https://simpleicons.org) (`simple-icons`, CC0, pinned). The marks remain their owners' trademarks and are used only to identify the service. `src/features/catalog/logos.ts` imports just the slugs the catalog names (a test checks the list covers the catalog), so the rest of the set isn't bundled, and nothing is fetched at runtime. Brands Simple Icons doesn't carry (Xbox, Nintendo, Microsoft, Blizzard games, Minecraft...) and user-added entries show initials instead. Logos too dark for the UI (under 3:1 against the card) are drawn in the text colour.
- An account's mark: for a game account its game, otherwise its platform, preferring whichever has a logo; with neither, the initials of its publisher or title.
- A platform's `default_login_url` is used by "Open login page" only when the account has no login page of its own, and the detail row and confirm dialog both say it came from the catalog.
- The account list filters by platform, game (including accounts with a profile for that game) and publisher in Rust (`AccountFilter`). Phase 11 replaced this with the full filter language.
- Game profiles have their own search rows (`entity_type = 'game_profile'`). Renaming a platform or game reindexes the accounts and profiles that name it; deleting an account removes its profiles' rows before the cascade.
- Email providers (Gmail, Outlook.com, Proton Mail, iCloud Mail, Yahoo Mail, AOL Mail, Zoho Mail, Tuta, Fastmail, GMX, mail.com, Mail.ru, Yandex Mail, HEY, mailbox.org) are built-in platforms. An email account without a platform shows its address's provider (from the domain, `emailProvider` in `logos.ts`), and the form offers to set that platform. On a new account whose name, type and platform are still blank, typing a known provider's address fills them in (type Email, the provider's platform, its name and publisher) with an Undo; once the user has started the account, the address is treated as just its login. Purpose isn't inferred: a mailbox can be Main, Recovery or Creator, and the domain can't tell. Outlook, Yahoo, AOL, Fastmail and Yandex show initials: their owners had their marks removed from Simple Icons, so there's no freely licensed logo to bundle.
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


## Phase 17: Passkeys and login credentials (scoped)

Not started. This is its own phase, after the MVP (Phases 0–16). Phase 7 owns account records, passwords, and MFA metadata, including the existing `hardware_key` method. This phase owns passkeys. It starts only once an account row exists to attach a credential to.

The product spec lists "Passkey management exploration" on the post-MVP roadmap, and hardware keys plus desktop autofill later still. ADR-0004 forbids autofill and auto-login. Windows Hello vault unlock is separate: ADR-0005 adds it in Phase 15b. This phase is the concrete cut of that exploration. It does not reopen Phase 7.

A passkey is a FIDO2/WebAuthn credential: a relying-party id, a credential id, and a private key that signs a challenge. Two different jobs use that shape. They ship as two cuts inside this phase.

**Cut A — account login credentials.** Vaultair stores passkeys for the user's own sites and apps, and can create or assert one when Windows asks, while the vault is unlocked and the user approves that site. This is the login support.

**Cut B — vault unlock.** A second header key slot, `kind: "windows-hello"`, wraps the same DEK. Windows Hello (PIN or biometric) unwraps it. The master password still creates the vault, still restores a backup, and still changes the password. Hello never replaces it. The slot is wiped on password change and on DEK rotation, and a reboot requires the master password again (the quick-unlock rules already in the implementation plan, §5).

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
- `private_key_enc` — field envelope. Never indexed, never in a DTO, never in a log.
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

- Passphrases use the [EFF large wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) by the Electronic Frontier Foundation, licensed [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/). It's embedded unmodified at `crates/vaultair-core/src/generator/eff_large_wordlist.txt`.
