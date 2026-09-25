# Vaultair

A local-first, encrypted Windows workspace for people who manage several gaming and online identities: accounts, identities, recovery codes, MFA and how they all connect, in one vault on your own disk. No cloud account, no network.

> **Status:** Phase 7 (accounts with encrypted secrets). Next: Phase 8, identities and contact points. Phase 17 (passkeys) is scoped below and is not part of Phase 7.
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

## Phase 17: Passkeys and login credentials (scoped)

Not started. This is its own phase, after the MVP (Phases 0–16). Phase 7 owns account records, passwords, and MFA metadata, including the existing `hardware_key` method. This phase owns passkeys. It starts only once an account row exists to attach a credential to.

The product spec lists "Passkey management exploration" on the post-MVP roadmap, and hardware keys plus desktop autofill later still. ADR-0004 keeps Windows Hello vault unlock deferred and forbids autofill and auto-login. This phase is the concrete cut of that exploration. It does not reopen Phase 7.

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
