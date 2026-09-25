# Implementation Plan: Vaultair MVP

## Overview
Vaultair is a local-first, Windows-first encrypted vault for people who run several gaming and online identities. It is built with Tauri v2: a Rust core owns all cryptography, storage, OS integrations and business rules, and a React/TypeScript webview handles presentation only. The plan puts the security foundation first (shell hardening, crypto core, vault format, lock semantics) and then adds features in the order of your 16 deliverables. Where a dependency justifies it, I've moved a deliverable earlier. Every phase ends with a runnable app.

**Current repo state (checked):** `C:\Users\theba\OneDrive\Documents\Fun_(SWE)\vaultair` contains only `skills-lock.json`, `.claude\skills\ui-ux-pro-max\` (SKILL.md, data CSVs, scripts) and `.agents\skills\design-taste-frontend\SKILL.md`. There's no source code, no package.json, no Cargo.toml, and no git repo yet.

**Two environment flags to deal with before Phase 0:**
1. **The project is inside OneDrive.** Cargo `target\` (several GB, thousands of files) and `node_modules\` will sync continuously and can lock files during builds. The `Fun_(SWE)` parentheses also sometimes cause quoting problems in scripts. Recommendation: move the repo to something like `C:\dev\vaultair`. If you'd rather not, at least set `CARGO_TARGET_DIR` to a location outside OneDrive.
2. **`design-taste-frontend` is under `.agents\skills\`, not `.claude\skills\`.** Claude Code discovers project skills from `.claude\skills\`. Check that the skill actually loads, and copy it into `.claude\skills\design-taste-frontend\` if it doesn't. Its own header also says it targets "Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI", and its default dials (8/6/4) are for landing pages. The design workflow below scopes it to match.

---

## 1. Architecture Overview

### 1.1 Process split and trust boundary

```
+--------------------------- WebView2 (untrusted-ish UI) ---------------------------+
| React + TS (strict) + Vite + Tailwind + shadcn/ui                                 |
| - Renders DTOs that never contain secrets (except explicit reveal responses)     |
| - Holds typed-in secrets only transiently in form state (create/edit)            |
| - No localStorage/sessionStorage/IndexedDB, no network, no console in release   |
+------------------------------------ IPC (invoke) ---------------------------------+
| src-tauri: thin command layer (validation, DTO mapping, error sanitising)         |
+-----------------------------------------------------------------------------------+
| vaultair-core (pure Rust, #![forbid(unsafe_code)], no Tauri dependency)           |
|  crypto/  vault/  db/  domain/  service/  search/  health/  graph/  generator/   |
|  backup/  redact/                                                                 |
+-----------------------------------------------------------------------------------+
| vaultair-platform (Rust; the only crate allowed `unsafe`; trait + Windows impl)   |
|  clipboard (exclusion formats), session lock (WTS), capture affinity, DPAPI later |
+-----------------------------------------------------------------------------------+
| Disk: <vault dir>\vault.vhdr (header) + vault.vdb (SQLCipher)                     |
+-----------------------------------------------------------------------------------+
```

**Rules for secrets crossing into JS:**
- **Copy never crosses into JS.** `clipboard_copy_secret({ref})` has Rust decrypt the field and write it to the clipboard. JS only gets `{clearAt}` back.
- **Reveal crosses into JS**, because display requires it. `secret_reveal({ref})` returns one value. The UI keeps it in component-local state and auto-hides it after 20 s (configurable). Lock and unmount clear it.
- **User input crosses JS → Rust**, which is unavoidable for typing. Forms hold secrets in uncontrolled or local state only (never global stores or the query cache), and clear on submit or unmount.
- **The generator returns its output to JS** for display. Strength scoring runs in Rust.
- **List/get DTOs expose flags, not values.** They carry `hasPassword`, `passwordStrength` (0–4), `mfaEnabled`, `backupCodesRemaining` and similar. Password fingerprints never leave Rust.
- **Enforce this at compile time.** In Rust, secrets are `secrecy::SecretString` / `SecretBox<[u8]>`, and these are *not* `Serialize`. Only a dedicated `RevealedSecret` newtype used by the reveal command's return type can serialize. That way a secret can't accidentally be added to a DTO.

**Unlock/lock state (Rust):** `AppState { session: Mutex<Session> }`, where `Session = Locked | Unlocked { conn: rusqlite::Connection, keys: VaultKeys (zeroize-on-drop), vault: VaultHandle, last_activity: Instant }`. Locking takes the state, drops the connection (SQLCipher wipes its key material), zeroizes the keys, emits `vault://locked`, and the frontend then runs `queryClient.clear()` plus a **full webview reload** so the JS heap is discarded. Every data command returns `AppError::VaultLocked` while locked, and a global frontend handler routes to the lock screen.

Argon2id and SQLCipher open run on `tauri::async_runtime::spawn_blocking` so the UI stays responsive during unlock.

### 1.2 IPC command surface (Tauri v2 `#[tauri::command]`)

Types are generated to TS with **tauri-specta** (pin the version; fall back to `ts-rs` if specta's v2 support gives trouble). Every command returns `Result<T, AppError>`. `AppError` serializes to `{ code, message }`, where the message is generic and user-safe and never echoes input.

| Group | Commands |
|---|---|
| App/vault | `app_info`, `recent_vaults_list`, `recent_vaults_forget`, `vault_kdf_calibrate`, `vault_create`, `vault_create_demo`, `vault_unlock`, `vault_lock`, `vault_status`, `vault_change_password` (P15), `vault_integrity_check` |
| Session | `session_touch` (throttled activity ping), `session_config_get` |
| Accounts | `account_list`, `account_get`, `account_create`, `account_update` (secret fields tri-state: `Unchanged` / `Set(String)` / `Clear`), `account_archive`, `account_unarchive`, `account_delete` (requires confirm token), `account_bulk_update_tags`, `account_bulk_archive`, `account_bulk_delete`, `account_duplicate_as_template`, `account_mark_verified`, `account_open_url` (validated http/https only) |
| Secrets | `secret_reveal`, `clipboard_copy_secret`, `clipboard_copy_plain` (username/email, still auto-cleared), `clipboard_cancel_clear`, `clipboard_clear_now` |
| MFA | `mfa_list_for_account`, `mfa_upsert`, `mfa_delete`, `mfa_set_backup_codes`, `mfa_mark_code_used`, (`totp_current_code` if the TOTP decision is yes, see §8) |
| Identities/contacts | `identity_list/get/create/update/archive/delete`, `identity_overview` (accounts, shared emails, recovery dependencies), `contact_point_list/upsert/delete` |
| Labels/catalog | `purpose_list/create/update/hide/delete(reassign_to)`, `platform_list/create/update`, `game_list/create/update`, `tag_list/rename/delete` |
| Game profiles | `game_profile_list/create/update/delete` |
| Connections | `connection_list/create/update/delete` |
| Search/views | `search`, `saved_view_list/create/update/delete`, `search_rebuild_index` |
| Generator | `generate_password`, `generate_passphrase`, `strength_estimate` |
| Health | `health_summary`, `health_issues` |
| Graph | `graph_query({focus, depth, limit})` |
| Backup | `backup_create`, `backup_status`, `backup_set_destination`, `backup_verify`, `backup_restore_to` (see §8) |
| Settings | `settings_get`, `settings_update`, `app_config_get`, `app_config_update`, `capture_protection_set` |
| Dashboard | `dashboard_summary` |

### 1.3 Tauri v2 capabilities, permissions and CSP lockdown

**`src-tauri/capabilities/main.json`**, scoped to window `main` only:
- `core:default` pared down to what's needed: `core:window:allow-minimize`, `allow-close`, `allow-start-dragging`, `allow-toggle-maximize` (custom titlebar), and `core:event:default`.
- `dialog:allow-open` and `dialog:allow-save`, for picking folders and backup destinations. The dialog returns a path, and Rust re-validates it.
- App commands are declared in `build.rs` through `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))`, so each command needs an explicit permission. Allow-list them in the capability file.

**Plugins:**
- **Use:** `tauri-plugin-dialog`, `tauri-plugin-single-instance` (one process per user, which avoids two processes opening one vault), and optionally `tauri-plugin-window-state` (geometry only).
- **Do not use:** `fs`, `shell`, `http`, `store`, `updater`, `log`, `opener`-from-JS. URLs are opened from Rust via `account_open_url`, which only accepts `https:`/`http:` from the stored record, and uses the `opener` crate or `ShellExecuteW`.

**`tauri.conf.json` security block:**
- `app.withGlobalTauri: false`, `app.security.freezePrototype: true`, `dangerousDisableAssetCspModification: false`, no `devCsp` relaxations shipped.
- CSP (production): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'self'`. Tauri injects its own hashes/nonces. Add `'unsafe-inline'` to `style-src` only if a specific dependency proves it's required. Never loosen `script-src`.
- Fonts are bundled locally, with no CDN font or icon loads.
- Window: `dragDropEnabled: false` (until attachments), no additional windows, and an `on_navigation` handler that rejects anything that isn't the app origin. `new-window` requests are blocked.
- WebView2 hardening via `WebviewWindow::with_webview` → `ICoreWebView2Settings`: `IsPasswordAutosaveEnabled=false`, `IsGeneralAutofillEnabled=false`, `AreBrowserAcceleratorKeysEnabled=false` (blocks F5, Ctrl+P and the like), `AreDefaultContextMenusEnabled=false` and `AreDevToolsEnabled=false` in release, `IsStatusBarEnabled=false`.
- Frontend lint guards: ESLint `no-restricted-globals` / `no-restricted-properties` for `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `XMLHttpRequest`, `WebSocket`; `no-console`. Vite `esbuild.drop: ['console','debugger']` in release.
- Supply-chain privacy guard: a `cargo-deny` `bans` list forbids network client crates (`reqwest`, `hyper`, `ureq`, and similar) in the MVP. That makes the "no network" claim mechanically checkable.

### 1.4 Recommended folder structure

```
vaultair/
  Cargo.toml                    # workspace: src-tauri, crates/*
  package.json, vite.config.ts, tsconfig.json (strict), eslint.config.js, components.json
  deny.toml, clippy.toml (disallowed-macros: dbg, println, eprintln)
  crates/
    vaultair-core/src/
      lib.rs, error.rs, redact.rs, clock.rs (injectable clock)
      crypto/ { kdf.rs, aead.rs, keys.rs (KEK/DEK/subkeys), envelope.rs (field enc), fingerprint.rs, rng.rs }
      vault/  { header.rs, layout.rs, create.rs, open.rs, rekey.rs, lockfile.rs, atomic_write.rs }
      db/     { connection.rs (SQLCipher pragmas), migrations/ (V1__init.sql, ...), migrate.rs,
                repo/{account.rs, identity.rs, contact.rs, purpose.rs, catalog.rs, game_profile.rs,
                      connection.rs, mfa.rs, tag.rs, saved_view.rs, settings.rs} }
      domain/ { account.rs, identity.rs, ... enums.rs, validation.rs }
      service/{ account_service.rs, identity_service.rs, ... session.rs, dashboard.rs }
      search/ { index.rs, query.rs, filters.rs }
      health/ { rules.rs, thresholds.rs }
      graph/  { builder.rs }
      generator/ { password.rs, passphrase.rs, strength.rs, wordlist_eff_large.txt }
      backup/ { container.rs, create.rs, verify.rs, restore.rs }
      demo/   { seed.rs }
      catalog/{ default_catalog.json }   # platforms/games seed data, not code enums
    vaultair-platform/src/
      lib.rs (traits: Clipboard, SessionEvents, CaptureProtection, DeviceSecretStore)
      windows/{ clipboard.rs, session.rs, capture.rs, dpapi.rs (Phase 2) }
      fake/   { clipboard.rs, session.rs }   # for tests
  src-tauri/
    src/{ main.rs, lib.rs, state.rs, events.rs, dto.rs, commands/{vault.rs, account.rs, ...}, bindings.rs }
    capabilities/main.json, tauri.conf.json, build.rs, icons/
  src/
    main.tsx, app/{ App.tsx, router.tsx, providers.tsx, lock-guard.tsx }
    ipc/{ bindings.ts (generated), client.ts (error normalisation), events.ts }
    domain/{ schemas.ts (zod), labels.ts, status.ts }
    components/ui/ (shadcn), components/common/ (StatusBadge, SecretField, CopyButton, EmptyState, ...)
    features/{ onboarding, lock, shell, dashboard, accounts, identities, games, platforms,
               graph, health, search, generator, backup, settings }
    stores/ (zustand: UI-only state), lib/, styles/ (tokens.css), test/ (setup, ipc mocks)
  docs/ (see §7), docs/adr/
  tests-fixtures/ (golden vault files for migration tests; test-only password)
```

**Frontend stack:**
- React 19, TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, Tailwind v4, shadcn/ui (Radix).
- TanStack Router (or React Router), TanStack Query for IPC caching (cleared on lock), Zustand for UI-only state, react-hook-form + zod.
- TanStack Table + TanStack Virtual, cmdk for the command palette, sonner for toasts, lucide-react icons.
- `@xyflow/react` + dagre for the graph, and `motion` used sparingly with `prefers-reduced-motion` respected.
- Rust stays the source of truth for validation. Zod is for UX only.

---

## 2. Crypto and Storage Choices

### 2.1 Options compared

| | A. SQLCipher-only (key derived by its PBKDF2) | B. App-level only (plain SQLite + per-field AEAD) | C. In-memory SQLite, encrypted whole-file blob (KeePass model) | **D. Recommended: SQLCipher (raw key) + Argon2id key hierarchy + field-level AEAD for extra-sensitive fields** |
|---|---|---|---|---|
| Meets "Argon2id" | No (PBKDF2) | Yes | Yes | Yes |
| Metadata encrypted at rest | Yes | Only if every column is encrypted, which breaks FTS, sort and index | Yes | Yes |
| FTS5 | Yes | No (or in-memory rebuild) | Yes (in memory) | Yes, stored encrypted in the same DB |
| Incremental, durable writes | Yes | Yes | No, rewrites the whole file per save | Yes |
| Secrets exposed in SQLite page cache and query results | Yes | No | Yes | **No** (secrets are ciphertext blobs until explicit reveal/copy) |
| Build complexity | C + OpenSSL | Pure Rust | Pure Rust | C + OpenSSL |
| Custom format surface | Small | Large | Medium | Small (header + envelope) |

**Recommendation: D.** Reasons:
- SQLCipher gives whole-database, page-level AES-256 with an HMAC per page, covering all metadata, indexes, FTS shadow tables and the journal.
- It's mature and widely deployed, and it keeps incremental ACID writes, which matter as data grows (activity history, attachment metadata).
- Argon2id is done in Rust, and SQLCipher gets a raw key, which satisfies the spec's KDF requirement.
- The second, field-level layer keeps passwords, TOTP secrets and recovery codes as ciphertext even inside the unlocked database. They don't show up in the SQLite page cache, in accidental `SELECT *` results, in FTS, or in DTOs. They're decrypted in Rust only at the moment of reveal or copy.
- Fallback: if the SQLCipher/OpenSSL build on Windows becomes a blocker, option C is the pure-Rust alternative. Record this in ADR-0002.

### 2.2 Crates

| Purpose | Crate |
|---|---|
| Encrypted DB | `rusqlite` with `bundled-sqlcipher-vendored-openssl`. **Windows build needs Strawberry Perl** for `openssl-src`, and possibly NASM unless built `no-asm`. Put this in the Phase 0 prerequisites and in CI. |
| KDF | `argon2` (RustCrypto), `Algorithm::Argon2id`, `Version::V0x13` |
| AEAD | `chacha20poly1305` (`XChaCha20Poly1305`: 24-byte random nonces, so random-nonce collision risk is negligible) |
| Subkeys | `hkdf` + `sha2` (HKDF-SHA256) |
| Fingerprints | `hmac` + `sha2` (HMAC-SHA256) |
| RNG | `rand_core::OsRng` / `getrandom` (BCryptGenRandom on Windows) |
| Memory hygiene | `zeroize` (`Zeroizing`, `ZeroizeOnDrop`), `secrecy` (SecretString/SecretBox, redacted Debug) |
| Strength | `zxcvbn` (Rust port) |
| Unicode | `unicode-normalization` (NFC for master password) |
| IDs/time | `uuid` (v7), `time` |
| Migrations | `rusqlite_migration` (or `refinery`) |
| TOTP (if in MVP) | `totp-rs` |
| Windows | `windows` crate (Win32 clipboard, WTS, DWM/affinity, DPAPI later) |
| Logging | `tracing`, `tracing-subscriber`, `tracing-appender` |
| Tests | `proptest`, `tempfile`, `insta` (optional) |

### 2.3 Key hierarchy

```
master password --NFC normalise--> Argon2id(salt, m, t, p) --> KEK (32 B, Zeroizing, discarded after unwrap)
KEK --XChaCha20-Poly1305 unwrap (AAD = authenticated header fields)--> DEK (32 B random, generated at vault creation)
DEK --HKDF-SHA256 info="vaultair/v1/sqlcipher"--> DB_KEY     -> PRAGMA key = "x'<hex>'" (raw key; SQLCipher's PBKDF2 skipped)
    --HKDF-SHA256 info="vaultair/v1/field"-----> FIELD_KEY  -> per-field XChaCha20-Poly1305 envelopes
    --HKDF-SHA256 info="vaultair/v1/pwfp"------> FP_KEY     -> HMAC-SHA256(password) for reuse detection
    --HKDF-SHA256 info="vaultair/v1/backup-mac"-> BACKUP_KEY -> backup container MAC
```

- **Changing the password** re-wraps the DEK only. Nothing else is re-encrypted, and it completes in about one Argon2 duration.
- **Caveat to document:** old backups and old header copies still open with the old password, because the DEK is unchanged. Offer a separate, heavier **"Rotate encryption key"** action: new DEK, `sqlcipher_export` into a fresh DB, re-encrypt all field envelopes. This is the right move when the user suspects the password was compromised. Recommendation: post-MVP, but design `rekey.rs` for it now.
- **The header uses a key-slot array** (LUKS-style): `key_slots: [{kind:"password", ...}]`. A future Windows Hello or user-held recovery-key slot can then wrap the same DEK without a format change.

### 2.4 Vault layout and file format

The vault is a folder the user chooses:
```
<location>\<VaultName>\
  vault.vhdr        header (~1 KB): magic "VAULTAIR", format_version u16, JSON body, CRC32 trailer
  vault.vdb         SQLCipher 4 database
  vault.vhdr.prev   exists only transiently during password change
  .lock             OS file lock held while open (second process/instance gets a "vault in use" error)
  attachments\      (Phase 2)
```
Two files is a real trade-off against a single file (see §8). SQLCipher needs a real random-access file, and the KDF parameters and wrapped key have to be readable before the DB can be opened.

**Header JSON body:**
- `vault_id`, `created_at`, `format_version: 1`, `min_reader_version`, `demo: bool`
- `kdf: { alg:"argon2id", v:19, m_kib, t, p, salt_b64 (32 B OsRng), out_len:32 }`
- `pw_normalization: "NFC"`
- `key_slots: [{ kind:"password", kdf_ref:"kdf", wrap:{ alg:"xchacha20poly1305", nonce_b64, ct_b64 } }]`
- `db: { engine:"sqlcipher", compat:4, page_size:4096, hmac:"HMAC_SHA512", kdf_iter_raw:... }`: pinned explicitly so a SQLCipher upgrade can't silently change defaults
- `field_envelope_version: 1`

**Integrity and anti-downgrade:**
- The wrap AEAD's AAD is the canonical serialization of every header field except the slot ciphertext. Tampering with `m_kib`, `t`, `salt` or `vault_id` therefore makes the unwrap fail.
- The reader also enforces **KDF floors** (m ≥ 64 MiB, t ≥ 3, p ≥ 1) before running Argon2. A tampered header can't force a weak KDF, and a huge value can't DoS memory either: cap m at 2 GiB.

**Error classification:**
- Bad magic, CRC mismatch or unparsable JSON → `VaultCorrupted(Header)`.
- Unknown newer format → `VaultTooNew`.
- AEAD failure → `WrongPasswordOrTamperedHeader`, shown in the UI as "Incorrect master password".
- AEAD ok but the DB won't open or `PRAGMA cipher_integrity_check` fails → `VaultCorrupted(Database)`.

**Atomic writes:** write `vault.vhdr.tmp`, `FlushFileBuffers`, then `ReplaceFileW` / `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`.

**SQLCipher pragmas on open (in order):**
- `PRAGMA key = "x'…'"` (the hex string is built in a `Zeroizing<String>`)
- pinned `cipher_*` settings
- `cipher_memory_security = ON`
- `temp_store = MEMORY` (prevents temp files for sorts and indices)
- `secure_delete = ON`
- `journal_mode = DELETE` (fewer sidecar files, safer with folder-sync tools; WAL is fine too, but DELETE keeps the layout simple)
- `synchronous = FULL`, `foreign_keys = ON`
- then run migrations.

**Versioning uses three independent numbers:**
- header `format_version`
- `PRAGMA user_version` + migrations table (schema)
- the per-blob envelope version byte

**Before any schema migration, create an automatic pre-migration backup.**

### 2.5 Extra-sensitive fields (field envelope)

- **Blob layout:** `[ver u8 = 0x01][nonce 24 B][ciphertext || tag 16 B]`, with AAD = `"vaultair|v1|" + table + "|" + column + "|" + row_id`. Binding the row ID means ciphertexts can't be swapped between rows or columns.
- **Field-encrypted:** `account.password`, `mfa_method.totp_secret`, `mfa_method.backup_codes` (JSON array of `{code, used}`), `mfa_method.recovery_instructions`, `account.sensitive_notes`, and `account_custom_field.value` when `is_secret = 1`.
- **Derived non-secret columns** live alongside: `password_fp` (HMAC with FP_KEY, used only for `GROUP BY` reuse detection and never returned to JS), `password_strength` (0–4, computed in Rust at write time), `password_changed_at`, `backup_codes_remaining`, and `has_totp`.
- **In memory:** decrypted values live in `Zeroizing<Vec<u8>>` / `SecretString` and are dropped immediately after copy or reveal. Known limits to document honestly: Rust moves and reallocs, WebView2 IPC buffers, JS strings, clipboard HGLOBAL memory and SQLite internals can't all be wiped.
- **No password hint feature.** Hints are a classic plaintext leak.

### 2.6 KDF parameters

- `vault_kdf_calibrate` runs Argon2id on the device during onboarding, targeting about 0.75–1.0 s.
- It's clamped to m ∈ [64 MiB, 512 MiB], t = 3, p = 4, with a default floor of m = 64 MiB / t = 3 / p = 4 (RFC 9106's second recommended option).
- The chosen values are stored in the header. Settings later offers "Strengthen KDF", which re-wraps with new parameters.

---

## 3. Data Model

All tables live inside SQLCipher. IDs are UUIDv7 text, timestamps are ISO-8601 UTC text, and enums are `TEXT` with `CHECK` constraints. Custom purposes and the platform/game catalog are data rows, not code enums.

```sql
-- V1__init.sql
CREATE TABLE vault_meta (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  vault_id TEXT NOT NULL,                -- mirrors header, for display/consistency check
  display_name TEXT NOT NULL,
  icon TEXT, color TEXT,
  encryption_version INTEGER NOT NULL,   -- mirror of header field_envelope_version (read-only in UI)
  kdf_summary TEXT NOT NULL,             -- mirror for display ("Argon2id 128 MiB / t3 / p4")
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE vault_settings (           -- one row per key; typed in Rust
  key TEXT PRIMARY KEY,                 -- auto_lock_minutes, clipboard_clear_seconds, reveal_hide_seconds,
  value TEXT NOT NULL,                  -- lock_on_session_lock, lock_on_sleep, lock_on_minimize,
  updated_at TEXT NOT NULL              -- backup_dir, last_backup_at, last_backup_status, health thresholds
);

CREATE TABLE purpose_label (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,            -- 'main','competitive',... stable for built-ins
  name TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  color TEXT, icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE platform (                  -- Steam, Battle.net, Discord, Xbox, PSN, email providers...
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('launcher','console','publisher','social','streaming','email','website','app','other')),
  publisher TEXT, default_login_url TEXT, icon TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE game (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  franchise TEXT, publisher TEXT, icon TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  primary_email TEXT, recovery_email TEXT,
  phone_ref TEXT,                        -- reference/masked by default (see §8)
  notes TEXT, color TEXT, icon TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Emails, phones, authenticators, hardware keys as first-class nodes (graph + "shared recovery" health)
CREATE TABLE contact_point (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone','authenticator_app','hardware_key','other')),
  value_normalized TEXT,                 -- lowercased email; phone ref; device label
  label TEXT,
  identity_id TEXT REFERENCES identity(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (kind, value_normalized)
);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('platform','launcher','game','console','social','streaming','email','website','app','other')),
  purpose_id TEXT NOT NULL REFERENCES purpose_label(id),
  identity_id TEXT REFERENCES identity(id) ON DELETE SET NULL,
  username TEXT, email TEXT,
  password_enc BLOB,                     -- field envelope; NEVER indexed
  password_fp BLOB,                      -- HMAC fingerprint; never leaves Rust
  password_strength INTEGER CHECK (password_strength BETWEEN 0 AND 4),
  password_changed_at TEXT,
  website_url TEXT, login_url TEXT,
  platform_id TEXT REFERENCES platform(id) ON DELETE SET NULL,
  game_id TEXT REFERENCES game(id) ON DELETE SET NULL,
  publisher TEXT, region TEXT, player_id TEXT, display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant','locked','suspended','retired','archived','unknown')),
  notes TEXT,                            -- indexed (non-sensitive notes)
  sensitive_notes_enc BLOB,              -- field envelope; NEVER indexed
  favorite INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  last_verified_at TEXT,                 -- set only by explicit user action
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE account_contact (           -- login email, recovery email/phone, authenticator
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  contact_point_id TEXT NOT NULL REFERENCES contact_point(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('login_email','recovery_email','recovery_phone','authenticator','hardware_key','other')),
  PRIMARY KEY (account_id, contact_point_id, role)
);

CREATE TABLE account_custom_field (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','secret','url','email','number','date')),
  value_text TEXT,                       -- used when not secret
  value_enc BLOB,                        -- used when field_type='secret'; NEVER indexed
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK ((field_type = 'secret' AND value_text IS NULL) OR (field_type <> 'secret' AND value_enc IS NULL))
);

CREATE TABLE tag (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT);
CREATE TABLE account_tag  (account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
                           tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE, PRIMARY KEY (account_id, tag_id));
CREATE TABLE identity_tag (identity_id TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
                           tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE, PRIMARY KEY (identity_id, tag_id));

CREATE TABLE game_profile (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES game(id),
  platform_id TEXT REFERENCES platform(id) ON DELETE SET NULL,
  gamertag TEXT, player_id TEXT, region TEXT, rank_tier TEXT, current_season TEXT, notes TEXT,
  linked_launcher_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  linked_console_account_id  TEXT REFERENCES account(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE platform_connection (
  id TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  destination_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('linked_login','recovery_email','shared_email',
     'shared_authenticator','shared_phone','connected_console','connected_launcher','connected_social','parent_child','custom')),
  custom_label TEXT,
  linked_at TEXT, verified_at TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (source_account_id <> destination_account_id),
  CHECK (relationship_type <> 'custom' OR custom_label IS NOT NULL),
  UNIQUE (source_account_id, destination_account_id, relationship_type)
);

CREATE TABLE mfa_method (                -- many per account
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL CHECK (method IN ('authenticator_app','totp','hardware_key','sms','email','recovery_codes_only','unknown')),
  contact_point_id TEXT REFERENCES contact_point(id) ON DELETE SET NULL,  -- phone/email/device used
  totp_secret_enc BLOB,                  -- NEVER indexed
  totp_algorithm TEXT, totp_digits INTEGER, totp_period INTEGER,
  backup_codes_enc BLOB,                 -- NEVER indexed
  backup_codes_remaining INTEGER NOT NULL DEFAULT 0,
  backup_codes_updated_at TEXT,
  recovery_instructions_enc BLOB,        -- NEVER indexed
  last_verified_at TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE saved_view (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  filter_json TEXT NOT NULL,             -- versioned filter DSL, validated in Rust
  is_builtin INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX ix_account_identity   ON account(identity_id);
CREATE INDEX ix_account_purpose    ON account(purpose_id);
CREATE INDEX ix_account_platform   ON account(platform_id);
CREATE INDEX ix_account_game       ON account(game_id);
CREATE INDEX ix_account_status     ON account(status);
CREATE INDEX ix_account_updated    ON account(updated_at DESC);
CREATE INDEX ix_account_fav        ON account(favorite) WHERE favorite = 1;
CREATE INDEX ix_account_archived   ON account(archived_at);
CREATE INDEX ix_account_email_norm ON account(lower(email));
CREATE INDEX ix_account_pwfp       ON account(password_fp) WHERE password_fp IS NOT NULL;
CREATE INDEX ix_account_verified   ON account(last_verified_at);
CREATE INDEX ix_acctag_tag         ON account_tag(tag_id);
CREATE INDEX ix_acccontact_cp      ON account_contact(contact_point_id, role);
CREATE INDEX ix_gp_account         ON game_profile(account_id);
CREATE INDEX ix_gp_game            ON game_profile(game_id);
CREATE INDEX ix_conn_src           ON platform_connection(source_account_id);
CREATE INDEX ix_conn_dst           ON platform_connection(destination_account_id);
CREATE INDEX ix_mfa_account        ON mfa_method(account_id);
CREATE INDEX ix_cp_identity        ON contact_point(identity_id);
```

**Seeding:**
- Built-in purposes: Main, Competitive, Ranked, Casual, Alt, Creator, Testing, Work, Shared household, Recovery, Other. **Smurf is pending your decision, see §9.**
- Built-in saved views: Main, Alts, Missing MFA, Missing recovery codes, Uses primary email, Recently updated, Dormant, High-priority.
- The platform/game catalog comes from `catalog/default_catalog.json`. Users can add, edit and hide entries, and nothing is hardcoded in TS or Rust logic.

**Hard vs soft delete:** "Archive" sets `archived_at`. "Delete permanently" is a real `DELETE` with cascades, and `secure_delete` zeroes the freed pages.

**Attachments (Phase 2, architected now):**
- An `attachment` table via a later migration: `id, account_id, blob_file, file_name, file_type, file_size, wrapped_file_key, created_at`.
- Blobs go in `<vault>\attachments\<uuid>.bin`, encrypted with a per-file random key using XChaCha20-Poly1305 STREAM (`aead::stream`) and wrapped by a FIELD_KEY-derived key.
- Activity history also arrives through a later migration.

### 3.1 Full-text search inside SQLCipher

- **Where it lives:** FTS5 is compiled into SQLCipher's bundled SQLite. The FTS table and its shadow tables are ordinary pages in the encrypted DB, so the index is encrypted at rest exactly like everything else. With `temp_store=MEMORY`, query-time temporaries never touch disk.
- **Table:** a standalone (non-external-content) table maintained by the Rust repository layer **inside the same transaction** as each write. It isn't trigger-based, because rows denormalize data across identity, purpose, tag, platform and game tables:
  ```sql
  CREATE VIRTUAL TABLE search_index USING fts5(
    entity_type UNINDEXED, entity_id UNINDEXED,
    title, username, email, game, platform, publisher, tags, identity, purpose, notes, region, player_id,
    tokenize = 'trigram case_sensitive 0'
  );
  ```
- **Tokenizer:** trigram supports substring matches on gamer tags and IDs (`xX_Sn1per`), emails and player IDs. Queries shorter than 3 characters fall back to a `LIKE 'q%'` prefix scan on title, username and player_id (cheap at vault scale). Index size is about 3x unicode61, which is irrelevant at this scale. Ranking uses `bm25()` with column weights (title > username/email > game/platform > others).
- **Coverage:** entity types `account`, `identity`, `game_profile` (gamertag, player ID, rank, game). Identity and purpose renames trigger reindexing of the affected accounts. `search_rebuild_index` exists for recovery, and integrity checks compare row counts.
- **Never indexed:** passwords, TOTP secrets, backup codes, recovery instructions, sensitive notes, secret custom fields, password fingerprints. There's a canary test for this (§6).
- **Filters** (game, platform, publisher, identity, purpose, status, MFA on/off, has recovery codes, favorite, archived, last verified, tag) are plain indexed SQL predicates. They're combined with the FTS `MATCH` subquery on `entity_id` and compiled from a validated filter DSL. SQL is never built from JS strings.
- **Target:** < 50 ms per query at 5,000 accounts.

---

## 4. Phased Build Order

Legend: D# = your deliverable number. Complexity: S / M / L. Every phase's acceptance criteria include "`npm run tauri dev` launches and all tests pass."

### Phase 0: Repo, toolchain, decisions (no deliverable; S)
- **Goal:** a buildable empty workspace and recorded decisions.
- **Actions:**
  - Move the repo out of OneDrive (or set `CARGO_TARGET_DIR`), `git init`, and add a `.gitignore` covering `target`, `node_modules`, `*.vdb`, `*.vhdr` and `*.vaultair-backup`, so no vault is ever committed.
  - Install prerequisites: MSVC Build Tools, Rust stable (msvc), Node LTS, WebView2 runtime, **Strawberry Perl** (for vendored OpenSSL).
  - Verify that `design-taste-frontend` loads (see the flag above).
  - Write ADR-0001 (stack), ADR-0002 (crypto/storage option D), ADR-0003 (vault layout), and answer the §8 decisions.
- **Files:** `README.md` (skeleton), `docs/adr/*`, `docs/threat-model.md` (first draft from the spec), `.github/workflows/ci.yml` (windows-latest: fmt, clippy -D warnings, test, cargo-deny, cargo-audit, npm lint/typecheck/test).
- **Acceptance:** CI green on an empty workspace, and ADRs merged.
- **Risks:** SQLCipher/OpenSSL build friction on Windows. Mitigation: build a throwaway spike crate with `rusqlite` `bundled-sqlcipher-vendored-openssl` *now* to de-risk Phase 3.

### Phase 1: D1, Tauri + React + TS Windows shell with security baseline (M)
- **Goal:** a hardened empty shell. The security posture is set before any feature lands.
- **Files:**
  - `Cargo.toml` (workspace), `src-tauri/*`, `crates/vaultair-core` (with `error.rs`, `redact.rs`), `crates/vaultair-platform` (traits only)
  - `src/main.tsx`, `src/app/*`, `src/ipc/client.ts`
  - `tauri.conf.json` (CSP, freezePrototype, withGlobalTauri false), `capabilities/main.json`, `build.rs` (AppManifest command permissions)
  - `eslint.config.js` (restricted globals), `clippy.toml`, `deny.toml` (network crate bans)
- **Also in this phase:**
  - WebView2 settings hardening via `with_webview`, and the navigation guard
  - single-instance plugin
  - a `tracing` setup writing to `%LOCALAPPDATA%\Vaultair\logs` (rolling, INFO, 7 files)
  - a panic hook that logs location only, with no payload formatting of user data
  - `Redacted<T>` and `redact_email()` / `redact_username()` helpers
  - `AppError` with safe serialization
- **Commands:** `app_info`.
- **Tests:** redaction unit tests (`redact_email("player@example.com")` → `"p****r@e*****e.com"` or similar), and an `AppError` serialization test asserting no source detail leaks. Frontend: Vitest + RTL setup with a smoke render, and `mockIPC` from `@tauri-apps/api/mocks` configured.
- **Acceptance:**
  - The app window opens with a custom titlebar.
  - CSP is active: an injected inline script is blocked (manual check noted in docs).
  - F5, Ctrl+P and the context menu are disabled in release.
  - cargo-deny fails if `reqwest` is added.
- **Risks:** CSP breaking Vite dev HMR. Mitigation: keep the dev CSP separate but never ship it, and add a CI check that the release config contains no `unsafe-eval`.

### Phase 2: D2, dark app shell with sidebar and design system (M)
- **Goal:** a premium, dark-first visual language and the navigation frame, with empty states for every sidebar destination.
- **Design workflow (the only phase where all three tools run in full):**
  1. **design-taste-frontend (decisions).** Produce the one-line Design Read, e.g. "desktop security utility for PC gamers and power users, trust-first, restrained premium dark language". **Override the dials** away from the landing-page default of 8/6/4 to about VARIANCE 4 / MOTION 3 / DENSITY 5–6, per its own trust-first row. Use it for brand direction, the anti-default checks (no purple-gradient/neon/glass defaults), onboarding and lock-screen composition, and empty-state voice. Don't use it for tables or dashboards, since it excludes them.
  2. **inspo MCP (references).** Call `recommend` once with a brief like "dark premium SaaS desktop app, security/dev-tool feel, sidebar navigation, dense-but-calm data views". Then run 1–2 `search_screens` passes (dashboards/sidebars; onboarding/auth screens) and `get_screen` on 3–5 references. Take composition only. Per inspo's own guidance, **stop calling it once tokens exist**, except for genuinely new screen types (Phase 4 onboarding, Phase 14 graph).
  3. **ui-ux-pro-max (implementation).** Pick a dark palette and type pairing from its data (`scripts/search.py` / `design_system.py`), then build the component inventory and run the UX checks: contrast ≥ 4.5:1, focus rings, keyboard nav, labelled icon buttons, reduced motion. It owns dashboards, tables and charts. Note that its 44 px touch-target rule is mobile-oriented. Adopt about 32–36 px hit areas for dense desktop views, and keep generous focus targets.
- **Files:**
  - `src/styles/tokens.css` (CSS variables: surfaces, borders, text tiers, status colors)
  - `src/components/ui/*` (shadcn: button, input, dialog, dropdown, command, tooltip, badge, tabs, table, sheet, toast via sonner)
  - `src/components/common/{StatusBadge, EmptyState, PageHeader, KeyboardHint}.tsx`
  - `src/features/shell/{Sidebar, Titlebar, GlobalSearchTrigger, AppLayout}.tsx`
  - `docs/design-system.md`
- **Status system:**
  - `StatusBadge` always renders **icon + text + color**: green active/secure (ShieldCheck), yellow needs attention (CircleAlert), orange warning (TriangleAlert), red high risk (ShieldX), gray dormant/archived/unknown (CircleDashed/Archive), blue/purple linked/info (Link2/Info).
  - Sidebar destinations: Dashboard, All Accounts, Identities, Games, Platforms, Relationship Map, Security Health, Archived, Settings. Favorites is a sidebar section listing starred accounts, not a page (ADR-0004 decision 20). Global search sits at the top and opens a cmdk palette on Ctrl+K.
- **Commands:** none new.
- **Tests:** RTL tests that every route renders an EmptyState, that StatusBadge exposes an accessible label and never relies on color alone, and vitest-axe on the shell.
- **Acceptance:** all routes navigable, keyboard-only navigation works, contrast checks pass, and `docs/design-system.md` records the design read, dials, palette, type and status semantics.
- **Risks:** drifting into gamer clichés or generic AI-SaaS defaults. Mitigation: run the design-taste pre-flight checklist before merging.

### Phase 3: D4 (pulled ahead of D3), crypto core and encrypted local persistence (L)
- **Goal:** a correct, tested vault engine. It's headless: the UI is unchanged and the app still runs.
- **Files:**
  - `crates/vaultair-core/src/crypto/{kdf, aead, keys, envelope, fingerprint, rng}.rs`
  - `vault/{header, layout, create, open, lockfile, atomic_write}.rs`
  - `db/{connection.rs, migrate.rs, migrations/V1__init.sql}`
  - `service/session.rs`, `clock.rs`
  - `docs/vault-format.md`, `docs/security-assumptions.md`, `docs/local-data-storage.md`
- **Commands (wired but UI-less):** `vault_kdf_calibrate`, `vault_create`, `vault_unlock`, `vault_lock`, `vault_status`, `vault_integrity_check`.
- **Tests (Rust, `tempfile` dirs):**
  - Round trips: create → lock → unlock → data persists across process restart (simulated by dropping all state).
  - Wrong password → `WrongPasswordOrTamperedHeader`, with no timing-dependent early exit before Argon2.
  - Header tampering, each of which must fail: salt/m/t/p/vault_id changed, nonce changed, truncated file, bad magic, bad CRC, `format_version` newer → `VaultTooNew`.
  - KDF floor enforcement and the m cap.
  - DB corruption (flip bytes in page N) → `VaultCorrupted(Database)`.
  - Missing `vault.vdb` or missing header, handled distinctly.
  - Envelope: AAD swap across rows/columns fails; the version byte is checked.
  - `.lock` prevents a second open.
  - Canary scan: raw `vault.vdb` bytes contain no plaintext canary.
  - `Debug` of `VaultKeys` prints `[REDACTED]`.
  - Commit the golden fixture vault v1 to `tests-fixtures/` for future migration tests.
- **Acceptance:** all of the above pass on the Windows CI runner. Unlock at default parameters takes ≤ 1.5 s on a mid-range machine. Docs describe the format precisely enough for an independent reader.
- **Risks:**
  - SQLCipher pinning mistakes break future opens. Mitigation: pinned pragmas stored in the header, plus golden fixtures.
  - Partial writes. Mitigation: atomic header writes, and `synchronous=FULL`.

### Phase 4: D3, vault setup (onboarding) and unlock/lock UI (M)
- **Goal:** a polished, confidence-inspiring first run, a lock screen, and manual lock.
- **Design:**
  - Use inspo for 1 targeted `search_screens` on onboarding/auth patterns plus `get_screen` on 2–3 references.
  - design-taste-frontend sets the onboarding composition and copy tone (calm, honest, not intimidating).
  - ui-ux-pro-max covers the stepper, form UX, error placement and strength-meter accessibility.
- **Steps:**
  1. Welcome
  2. Local-first explanation (the privacy promises)
  3. "We can't recover your master password": an explicit acknowledgement checkbox
  4. Vault name
  5. Storage location: default `%LOCALAPPDATA%\Vaultair\Vaults\`, with a **warning when the chosen path is under OneDrive, Dropbox or Google Drive, or a Known-Folder-Moved Documents folder**
  6. Create and confirm the master password, with zxcvbn feedback and the policy from §8
  7. KDF calibration, shown as "Securing your vault…"
  8. Optional recovery checklist: where to write the password down physically, and a reminder to make an encrypted backup. It stores nothing secret and is not a backdoor.
  9. Backup recommendations
  10. Dashboard
- **Lock screen:** vault name, master password field, "Open a different vault", recent vaults list (paths only; app config stores no vault contents), and progressive UI backoff after 5 failures (cosmetic; the real rate limit is Argon2).
- **Also:** the titlebar/sidebar "Lock" action, the Ctrl+L shortcut, and `vault_create_demo` (fake data comes in Phase 7+).
- **Files:**
  - `src/features/onboarding/*`, `src/features/lock/*`, `src/app/lock-guard.tsx`
  - `src-tauri/src/commands/vault.rs`, `src-tauri/src/events.rs`
  - `docs/privacy-statement-draft.md`, `docs/forgot-master-password.md` (the onboarding copy comes from these)
- **Commands:** `recent_vaults_list/forget`, `strength_estimate`, `app_config_get/update`, plus the Phase 3 commands.
- **Tests:**
  - RTL: password mismatch blocks progress, weak password blocks progress per policy, the acknowledgement is required, the cloud-folder warning appears for OneDrive paths (with the path classifier unit-tested in Rust).
  - Wrong password shows a generic message.
  - The `vault://locked` event clears the query cache and triggers a reload.
  - Password inputs have `autocomplete="off"` / `spellcheck={false}`.
- **Acceptance:** you can create a vault, lock, unlock, restart the app, and unlock again. The master password never appears in any store, log or URL.
- **Risks:** onboarding that's too long and scary. Mitigation: progress indicator, a skippable recovery checklist, and plain-language copy reviewed against the threat model.

### Phase 5: D12 + D11 (pulled ahead), auto-lock, session lock, clipboard service, capture protection (M)
- **Goal:** all lock and clipboard safety exists *before* any real secret data can be entered.
- **Files:**
  - `crates/vaultair-platform/src/windows/{session.rs, clipboard.rs, capture.rs}`, `fake/*`
  - `crates/vaultair-core/src/service/session.rs` (inactivity deadline)
  - `src-tauri/src/state.rs` (tokio tasks)
  - `src/features/shell/ActivityTracker.tsx`
  - `src/components/common/ClipboardToast.tsx`
- **Details:** see §5.
  - **Inactivity:** Rust owns the deadline. The frontend sends `session_touch` at most every 15 s on pointer and keyboard activity. Default 5 minutes, configurable.
  - **Clipboard:** the Rust timer defaults to 30 s. The toast shows a countdown with "Keep in clipboard" (cancel) and "Clear now".
  - **Other lock triggers:** lock on session lock (default on), on sleep (default on), and on minimize (default off).
  - Clear the clipboard on lock and on exit, only if the content is still ours.
- **Commands:** `session_touch`, `session_config_get`, `clipboard_copy_plain` (testable with a dev-only sample string until Phase 7), `clipboard_cancel_clear`, `clipboard_clear_now`, `capture_protection_set`.
- **Tests:**
  - Fake clock (`tokio::time::pause`): the auto-lock fires at the deadline, a touch extends it, and a locked session rejects commands.
  - A fake SessionEvents injecting `Lock` triggers a vault lock.
  - Fake clipboard: clears after N seconds, cancel prevents the clear, and it **doesn't clear if the sequence number changed** (the user copied something else).
  - Clear on lock.
  - `#[cfg(windows)] #[ignore]` real-clipboard test asserting the three exclusion formats are present (run manually or serially in CI).
- **Acceptance:** Win+L locks the vault. Idle for the timeout locks it. A copied value doesn't appear in the Win+V history. OBS window capture shows the window as black when capture protection is on.
- **Risks:**
  - `OpenClipboard` contention. Mitigation: retry with backoff.
  - Subclassing the Tauri HWND. Mitigation: isolated module, unregistered on destroy.

### Phase 6: D10 (pulled ahead), password generator (S–M)
- **Why earlier:** the account form in Phase 7 embeds it.
- **Files:** `crates/vaultair-core/src/generator/{password, passphrase, strength}.rs` (EFF large wordlist, CC-BY attribution in the README), `src/features/generator/{GeneratorPanel, GeneratorPopover}.tsx`.
- **Rules:**
  - Length 8–128, default 20. Character classes: upper, lower, digits, symbols. Optional "exclude ambiguous" (`Il1O0o` plus a configurable set).
  - Every selected class is guaranteed via **rejection sampling** (regenerate until satisfied), so positions stay unbiased. Selection uses `OsRng` with an unbiased `gen_range`.
  - Passphrase mode: 3–12 words, separator, optional capitalization and number.
  - Shows entropy bits plus the zxcvbn score. Copy goes through the clipboard service. "Save to account" is wired in Phase 7.
- **Commands:** `generate_password`, `generate_passphrase`, `strength_estimate`.
- **Tests:** proptest over lengths and class combinations (always satisfies constraints, correct length, no excluded characters); a chi-square-ish distribution sanity test (loose bound, long run, `#[ignore]` by default); an entropy calculation test; UI tests for option toggles, disabling the last class, and the copy toast.
- **Acceptance:** the generator runs from the sidebar or palette, the strength meter shows a text label plus color, and copying auto-clears.
- **Risks:** the "at least one of each" logic introducing bias. Mitigation: rejection sampling, not forced positions.

### Phase 7: D5, account CRUD with encrypted secrets (L)
- **Goal:** the core record type, end to end.
- **Files:**
  - `domain/account.rs`, `repo/account.rs`, `repo/mfa.rs`, `repo/tag.rs`, `service/account_service.rs`, `demo/seed.rs`, `src-tauri/src/commands/{account, secret, mfa}.rs`
  - `src/features/accounts/{AccountsPage, AccountDetail (two-column), AccountForm, SecretField, CopyButton, MfaSection, CustomFieldsEditor, DeleteConfirmDialog}.tsx`
- **Behaviors:**
  - Create, edit, archive/unarchive, and permanent delete. Delete requires typing the account title, and the backend requires a confirm token.
  - Favorite, tags, notes vs sensitive notes, website/login URL, custom fields (with a secret type).
  - "Duplicate as alt template" copies the platform, game, publisher, region, identity, tags and custom-field labels, and **clears the username, email, password, MFA secrets, codes and player ID**.
  - "Open login page" calls `account_open_url` (http/https only, plus a confirm dialog showing the domain).
  - Copy username/email/password, reveal password (click or hold, auto-hide).
  - MFA section: method, enabled, TOTP secret (stored encrypted), backup codes (paste, then parsed and stored encrypted; the remaining count is shown; copy a single code; mark it used).
  - "Mark verified" sets `last_verified_at` by manual user action only.
  - `password_changed_at` updates only when the password value changes. Strength and fingerprint are computed in Rust.
  - The detail layout follows the spec. Attachments and activity-history panels are hidden or shown as "Coming later", see §9.
  - Demo seed data uses RFC 2606 domains (`example.com`, `.invalid`), passwords generated at runtime, and a "Demo vault" banner.
- **Commands:** account_*, secret_reveal, clipboard_copy_secret, mfa_*, tag_list, account_mark_verified, account_open_url.
- **Tests:**
  - Rust CRUD integration tests, cascade on delete, and the tri-state secret update (Unchanged doesn't touch the blob).
  - Missing required fields (title, purpose) are rejected with field-level error codes.
  - URL validation rejects `javascript:`, `file:` and `ms-settings:`.
  - The duplicate template carries no secrets.
  - **DTO secrecy test:** serialize every non-reveal command response for a canary-filled vault and assert the canary is absent.
  - **Log canary test:** capture tracing output during full CRUD and assert no canary, username or email in cleartext.
  - Decrypted-DB export test: `sqlcipher_export` to plaintext in a temp dir, then grep for the canary password. It must be absent thanks to the field layer.
  - RTL: reveal auto-hides and clears on unmount, the copy toast has a cancel, delete confirmation is enforced, form validation works, and empty states render.
- **Acceptance:** full account lifecycle via the UI. Secrets are hidden by default everywhere. The demo vault is browsable.
- **Risks:** secrets lingering in React state. Mitigation: `SecretField` owns the revealed value locally, there's a lint rule against putting reveal results in query cache keys, and the webview reloads on lock.

### Phase 8: D6, identity CRUD and contact points (M)
- **Files:** `repo/{identity, contact}.rs`, `service/identity_service.rs`, `src/features/identities/{IdentitiesPage, IdentityDetail, IdentityForm, RecoveryDependencies}.tsx`, plus the dashboard identity filter hook.
- **Behaviors:**
  - Identity CRUD and archive. Assign accounts (in the form and in bulk).
  - The identity overview shows its accounts grouped by platform, shared emails, recovery methods (from `account_contact`), and platforms used.
  - Recovery dependencies: which accounts recover through which email or phone, and which of those emails themselves lack MFA.
  - Account save auto-upserts a `login_email` contact point (normalized). Deleting an identity asks whether to reassign or unassign its accounts.
- **Commands:** identity_*, identity_overview, contact_point_*.
- **Tests:** email normalization; shared-email grouping; the dependency query; `ON DELETE SET NULL` behavior; identity filter applied to the dashboard summary; RTL empty states and form validation.
- **Acceptance:** you can create "Competitive" and "Creator" identities, assign accounts, and see shared emails and recovery dependencies.
- **Risks:** duplicate contact points from inconsistent casing. Mitigation: normalization in one Rust function, plus a UNIQUE constraint.

### Phase 9: D7, purpose labels including custom (S)
- **Files:** `repo/purpose.rs`, `src/features/settings/PurposeLabels.tsx`, `src/components/common/PurposeBadge.tsx`.
- **Behaviors:** built-ins can be hidden but not deleted. Custom labels can be created, renamed, recolored, reordered and deleted, with reassignment of affected accounts required. Renaming reindexes search.
- **Tests:** a built-in can't be deleted; delete-with-reassign moves accounts; slug uniqueness; FTS reflects renames.
- **Acceptance:** a custom purpose (e.g. "Tournament") can be used in forms, filters and badges.
- **Risks:** low.

### Phase 10: D8, game/platform fields, catalog, game profiles, filtering (M)
- **Files:** `repo/{catalog, game_profile}.rs`, `catalog/default_catalog.json`, `src/features/{games, platforms}/*`, `src/features/accounts/GameProfilesSection.tsx`.
- **Behaviors:**
  - Games and Platforms pages list the accounts and profiles grouped under them.
  - Users can add and edit catalog entries. Built-in `default_login_url` values are clearly labelled as catalog-provided (see §9).
  - GameProfile CRUD on an account: gamertag, player ID, rank/tier, season, linked launcher/console account.
  - Filters for game, platform and publisher.
- **Tests:** catalog seed loads idempotently (re-running migrations doesn't duplicate); profile cascade; filter predicate SQL tests; linked-account FK to a deleted account becomes NULL.
- **Acceptance:** you can filter All Accounts by game "Call of Duty" and see Activision/Battle.net accounts and profiles.
- **Risks:** catalog staleness. Mitigation: it's data, not code, and users can edit it.

### Phase 11: D9, global search and list views (L)
- **Files:** `search/{index, query, filters}.rs`, `repo/saved_view.rs`, `src/features/search/{CommandPalette, SearchResults}.tsx`, `src/features/accounts/{AccountTable, AccountCards, AccountCompact, FilterChips, SavedViews, BulkActionBar}.tsx`.
- **Behaviors:**
  - FTS per §3.1, with a filter DSL (versioned JSON) validated in Rust.
  - Table, card and compact views with virtualization; sorting; multi-select; bulk tag and bulk archive; **bulk delete that requires typing "DELETE <n> ACCOUNTS"**.
  - Saved views, both built-in and user-defined. The Archived sidebar entry is a saved view; the Favorites sidebar section lists starred accounts directly (ADR-0004 decision 20).
- **Commands:** `search`, `saved_view_*`, `search_rebuild_index`, `account_bulk_*`.
- **Tests:**
  - **Secret non-indexing canary:** a password or backup code equal to `CANARY7F3A` returns zero hits, and `SELECT * FROM search_index` contains no canary.
  - Trigram substring hits; fallback for queries under 3 characters.
  - Each filter individually and in combination; the invalid filter DSL is rejected.
  - Index consistency after update, delete and identity rename; rebuild equals incremental.
  - Performance test: 5k seeded accounts, p95 < 50 ms (`#[ignore]` in fast CI).
  - RTL: chip add/remove maps to the right query object; bulk delete confirmation.
- **Acceptance:** Ctrl+K finds accounts by gamertag fragment, and saved views work.
- **Risks:** FTS drifting from source tables. Mitigation: same-transaction updates, a rebuild command, and a count check in `vault_integrity_check`.

### Phase 12: D13, health checks (M)
- **Files:** `health/{rules, thresholds}.rs`, `service/dashboard.rs`, `src/features/health/*`, `src/features/dashboard/*` (the dashboard becomes fully populated here).
- **MVP rules (per the deliverable):** weak (strength ≤ 1), reused (`password_fp` count > 1), missing MFA (no enabled `mfa_method`), missing recovery codes (MFA enabled but `backup_codes_remaining = 0`).
- **Cheap additions from spec §8, included if time allows:** stale password change, stale verification, dormant, missing recovery email, incomplete required fields, many accounts per email or recovery method (threshold setting, default 5).
- Each issue has a severity (maps to a status color, icon and label), a reason and a "Fix" deep link.
- The dashboard shows counts, recent, favorites, needs-attention, health counts and quick actions.
- **Commands:** `health_summary`, `health_issues`, `dashboard_summary`.
- **Tests:** a table-driven test per rule, including boundaries (exactly the threshold); reuse detection doesn't return fingerprints; archived accounts are excluded by default; identity-filtered summary; DTO canary test extended.
- **Acceptance:** the demo vault shows sensible issues, and every issue links to its fix.
- **Risks:** fingerprint-based reuse detection only works within one vault. That's fine; document it.

### Phase 13: D14, relationship map MVP (L)
- **Design:** one inspo `search_screens` for graph or network visualizations and a `get_screen` on 2 references. design-taste-frontend decides the node visual language (restrained, labelled). ui-ux-pro-max checks legend, contrast and keyboard access.
- **Files:** `graph/builder.rs`, `src/features/graph/{RelationshipMap, GraphCanvas, NodeCard, Legend, GraphListView, graphMapper.ts}`.
- **Behaviors:**
  - Pick a focus (identity, account, email, platform, game). Rust returns nodes and edges at depth ≤ 2 with a cap of 300 nodes (a "truncated" flag with a hint to narrow the view).
  - Node types: identity, email, account, platform, game, MFA method, recovery method.
  - Edges are labelled and styled by relationship type, never by color alone. Dagre layout.
  - Clicking a node opens its record.
  - **The list/tree fallback** renders the same data and is the default under reduced motion or large graphs.
  - No password, secret or strength data on nodes.
- **Commands:** `graph_query`.
- **Tests:**
  - Rust builder: the spec's example tree (Primary Gaming Identity → Primary Email → Battle.net → Activision/CoD Main, and so on) produces the expected nodes and edges. The depth cap and node cap are respected. A canary is absent from the graph DTO.
  - `graphMapper.ts` is a pure-function unit test.
  - RTL: the list fallback is keyboard-navigable, and clicking a node navigates.
- **Acceptance:** the demo vault's graph is readable, and the list view is equivalent.
- **Risks:** layout performance and visual clutter. Mitigation: caps, focus-based queries, and the list fallback.

### Phase 14: D15, encrypted backup (M)
- **Files:** `backup/{container, create, verify, restore}.rs`, `src/features/backup/*`, `docs/backup-restore.md`.
- **Container `*.vaultair-backup`:**
  - magic, version, created_at, vault_id, header bytes (length-prefixed), DB bytes, then HMAC-SHA256 (BACKUP_KEY) over everything before it.
  - The DB bytes come from the SQLite online backup API into a temporary *SQLCipher* file keyed with the same DB_KEY, so plaintext never touches disk. The whole file is written to a `.tmp` and atomically renamed.
  - File name: `<VaultName>-YYYYMMDD-HHMMSS.vaultair-backup`.
  - The backup opens with **the master password that was current when the backup was made** (documented).
- **UI:** choose a destination (with the cloud-folder notice when applicable), "Back up now", backup age, last success or failure in Settings, and a reminder when the last backup is older than N days.
- **CSV export:** not built (see §9).
- **Commands:** `backup_set_destination`, `backup_create`, `backup_status`, `backup_verify` (opens a copy, checks the HMAC and runs `cipher_integrity_check`), and `backup_restore_to` if approved (§8).
- **Tests:**
  - Backup → verify → restore to a new directory → record counts and a sample decrypted secret match.
  - Tampered byte → HMAC failure. Truncated file → corrupted. Wrong password on restore → the standard error.
  - Destination not writable → a clean error, and `last_backup_status=failed`.
  - A plaintext canary is absent from the backup bytes.
  - An invalid or garbage file offered to restore → `InvalidBackup`. This covers the "invalid import" negative test in the MVP.
- **Acceptance:** you can create, verify and (if approved) restore a backup entirely through the UI.
- **Risks:** a backup that has never been restored. Mitigation: the verify and restore commands.

### Phase 15: D16, settings for vault, privacy, lock timeout, clipboard timeout (M)
- **Files:** `src/features/settings/{General, Security, Privacy, Backup, Labels, Catalog, About}.tsx`, `vault/rekey.rs` (re-wrap).
- **Settings:**
  - Vault name, icon and color.
  - Auto-lock minutes (1–120 or never, where "never" needs explicit confirmation), lock on session lock, sleep or minimize.
  - Clipboard clear seconds (10–300; "never" not offered), reveal auto-hide seconds.
  - Screen-capture protection.
  - KDF summary and "Strengthen KDF".
  - **Change master password** (re-wrap the DEK; warn about old backups).
  - The privacy promises page, log folder location and "Open logs folder", backup destination and status.
  - About: versions, licenses, EFF wordlist attribution.
  - Settings that must apply while locked (capture protection, last vault path) live in the app config (`%APPDATA%\Vaultair\config.json`, no vault contents). Everything else lives in `vault_settings`.
- **Commands:** `settings_get/update`, `vault_change_password`, `app_config_*`.
- **Tests:**
  - Change password: the new password opens and the old doesn't. Simulated crash after writing `.tmp` → the original header is intact. Simulated crash after rename → the new header works.
  - Settings bounds validation. Timeout changes take effect without restart.
- **Acceptance:** every setting persists and applies, and the change-password flow is robust to interruption.
- **Risks:** the header replacement race. Mitigation: `.prev` retention and atomic replace.

### Phase 15b: Quick unlock with Windows Hello, and tray (M–L)
- **Decided in** [ADR-0005](adr/0005-quick-unlock.md). Before any of this, a 1–2 day spike that isn't merged: check that the Hello prompt shows in front of the frameless window, and that `RequestSignAsync` returns the same signature for the same challenge.
- **Files:**
  - `vaultair-platform`: a `QuickUnlockKey` trait (`available`, `enroll`, `sign`, `delete`), `windows/{hello, dpapi}.rs`, and `FakeHello` in `fake.rs`.
  - `vaultair-core`: `vault/device_slot.rs`, an `open_with_dek` split out of `open.rs`, `service/quick_unlock.rs` (policy), and `unlock_quick` in `service/session.rs`.
  - `src-tauri`: `commands/quick_unlock.rs`, plus tray and close-to-tray handling in `lock.rs`.
  - UI: `LockScreen` (auto Hello prompt, "Use master password" link) and `settings/Security.tsx` (enable, forget this device, tray toggle).
- **Behaviors:**
  - The wrapped DEK is kept in `%LOCALAPPDATA%\Vaultair\devices\<vault_id>.qu` (DPAPI plus a Hello-derived key, bound to the password slot). `vault.vhdr` doesn't change.
  - The master password is required on enable, after a Windows restart, after 7 days, after 3 failed or cancelled Hello attempts, after a password change, and for sensitive actions.
  - Non-TPM Hello is allowed with a warning. "Keep running in the tray" is optional, and closing then hides to the tray.
- **Windows crate features:** `Security_Credentials`, `Security_Credentials_UI`, `Security_Cryptography`, `Storage_Streams`, `Foundation`, `Win32_Security_Cryptography`, `Win32_System_SystemInformation`; Tauri `tray-icon`.
- **Commands:** `quick_unlock_status`, `quick_unlock_enable`, `quick_unlock_unlock`, `quick_unlock_forget`, and settings for the tray.
- **Tests:**
  - A round trip with `FakeHello`.
  - Rejection of a wrong signature, a wrong `vault_id`, a tampered sidecar byte, and a changed password.
  - The restart, 7-day and 3-failure rules, and a forged or edited policy record being refused.
  - Canary: DEK bytes never appear in the sidecar, errors or logs; `Zeroizing` and redacted `Debug` on every intermediate value.
  - A DPAPI round trip in CI, and a real-Hello test marked `#[ignore]`.
  - RTL: falls back to the password on cancel, and shows password-only when a rule requires it.
- **Acceptance:** after one password unlock, relocking (idle, Win+L, sleep) and reopening the app within the same Windows session unlocks with Hello in about 1 s. A restart, 7 days, or a password change asks for the password again.
- **Risks:** a weak Hello PIN, non-TPM keys, and a change in Windows' signature scheme (falls back to the password and re-enrolls). All are documented in `threat-model.md`.

### Phase 16: Release hardening (not in the deliverable list, but needed; M)
- **Work:**
  - Final documentation pass (§7).
  - A threat-model review against the implementation, and a secret-flow audit: grep for `secret_reveal` call sites and review every `Serialize` impl.
  - `cargo audit` and `npm audit` clean.
  - Installer (Tauri NSIS; per-user install).
  - Code signing decision (§8).
  - E2E smoke with `tauri-driver` + WebdriverIO on Windows: create vault → add account → copy → lock → unlock → backup.
  - `SECURITY.md` (disclosure policy).
- **Acceptance:** a signed (or explicitly unsigned beta) installer, all docs present, and E2E smoke green.

---

## 5. Windows Specifics

**Session-lock detection**
- Obtain the main window's HWND (`WebviewWindow::hwnd()`), call `WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)`, and install `SetWindowSubclass` to observe `WM_WTSSESSION_CHANGE`.
- Lock on `WTS_SESSION_LOCK`, `WTS_SESSION_LOGOFF`, `WTS_CONSOLE_DISCONNECT` and `WTS_REMOTE_DISCONNECT`.
- Also handle `WM_POWERBROADCAST` / `PBT_APMSUSPEND` (sleep) and `WM_QUERYENDSESSION`.
- Forward events over a channel to the tokio session task. Unregister (`WTSUnRegisterSessionNotification`, `RemoveWindowSubclass`) on window destroy.
- Prefer subclassing the real top-level window over a message-only window: WTS notifications to `HWND_MESSAGE` windows are unreliable.

**Clipboard auto-clear**
- In one `OpenClipboard` session: `EmptyClipboard` → `SetClipboardData(CF_UNICODETEXT)`, then set these registered formats:
  - `ExcludeClipboardContentFromMonitorProcessing` (any data; tells monitors and history to ignore the item)
  - `CanIncludeInClipboardHistory` = DWORD 0
  - `CanUploadToCloudClipboard` = DWORD 0
- Then `CloseClipboard` and record `GetClipboardSequenceNumber()`.
- On timer expiry, lock or exit, clear **only if the sequence number is unchanged**, so a later user copy is never wiped.
- Retry `OpenClipboard` with backoff (it fails when another process holds the clipboard).
- Pass Vaultair's HWND as the clipboard owner.
- Caveats for the threat model:
  - Third-party clipboard managers may ignore these formats.
  - A crash before the clear leaves the value in place. Optional mitigation: persist the pending sequence number in the app config and clear on next start if it still matches (numbers reset on reboot, so only clear on an exact match within the same boot).
  - Clipboard HGLOBAL memory can't be zeroed.
- `tauri-plugin-clipboard-manager` can't set custom formats, so this must be native.

**Screen-capture protection**
- `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` on Windows 10 2004+. On older builds it behaves like `WDA_MONITOR` (black box), so detect and fall back.
- It hides the window from BitBlt, Desktop Duplication and Windows.Graphics.Capture consumers: OBS/Discord streaming, screenshot tools, and Windows Recall on Copilot+ PCs (check exact Recall behavior at implementation time).
- It does **not** stop a determined attacker or a compromised OS.
- It's a toggle in settings and in the app config (it must apply at launch while locked). See §8 for the default.

**DPAPI and Credential Manager scoping**
- **Superseded by [ADR-0005](adr/0005-quick-unlock.md) and Phase 15b:** quick unlock uses a Hello-signed device sidecar, not a header key slot, and never Credential Manager. The notes below are the original design, kept for history.
- MVP: master password only. No OS-level unlock, and nothing written to Credential Manager.
- Phase 2 "quick unlock" design:
  - Add a `key_slot {kind:"windows-hello"}` whose wrapping key is protected by Windows Hello (`KeyCredentialManager` / `UserConsentVerifier` gating), with the wrapped material stored via DPAPI (`CryptProtectData`, `CRYPTPROTECT_UI_FORBIDDEN`, per-vault entropy).
  - If Credential Manager is used, the target is `Vaultair/<vault_id>/quickunlock`, with **`CRED_PERSIST_LOCAL_MACHINE`, never `CRED_PERSIST_ENTERPRISE`** (enterprise roams with roaming profiles). Some wrapper crates (e.g. `keyring`) choose the persistence mode for you, so verify it or call `CredWriteW` directly.
- Documented limit: plain DPAPI is decryptable by *any process running as the same user*. That's why Hello gating plus user opt-in is required.
- Additional rules:
  - Invalidate the slot on password change, DEK rotation, or N days.
  - Always require the master password after reboot (configurable).
  - It never substitutes for the master password; you can't create or restore a vault with it.

**Other Windows notes**
- WebView2's user data folder (`%LOCALAPPDATA%\<identifier>\EBWebView`) holds cache and no vault data, since we never use web storage. Document it in local-data-storage.md.
- WebView2 runtime telemetry is governed by Windows settings; mention it in the privacy statement.
- Detect cloud-synced folders by checking the path against the `OneDrive`, `OneDriveCommercial` and `OneDriveConsumer` environment variables, the Known Folder paths (`SHGetKnownFolderPath`) for redirected Documents, and common Dropbox/Google Drive roots.

---

## 6. Testing Strategy

**Rust unit tests (vaultair-core):**
- kdf: parameter floors and caps; calibration bounds.
- aead/envelope: round trip, AAD binding, version byte.
- keys: HKDF subkeys differ per info; redacted Debug.
- header: parse, serialize, CRC; tamper matrix.
- generator: proptest.
- health rules: table-driven.
- filter DSL validation; redaction helpers; URL validation; email normalization.

**Rust integration tests (tempdir vaults):**
- Create, lock, reopen and persist.
- Migrations against **golden fixture vaults** from every released format version.
- Backup, verify and restore.
- Change password, including crash-point simulations.
- FTS consistency.
- 5k-account performance (ignored by default).
- `vault_integrity_check`.
- Single-open `.lock` behavior.

**Security canary suite:** seed a vault where every secret contains `CANARY7F3A` and every username/email contains `CANARYUSER`, then assert:
- the raw `.vdb`, `.vhdr` and backup bytes contain no canary;
- a plaintext `sqlcipher_export` of the DB contains no canary *secret* (the field layer works);
- `search_index` contains no canary secret;
- every non-reveal DTO lacks secrets;
- captured `tracing` output across full workflows lacks canary secrets *and* unredacted canary usernames/emails;
- `AppError` messages lack canaries;
- the panic hook output lacks canaries.

**Platform tests:**
- Fake clipboard and fake session events with a paused tokio clock: auto-clear, cancel, the sequence-number guard, clear on lock, idle lock, and session-lock lock.
- `#[cfg(windows)]` ignored tests against the real clipboard and exclusion formats, and display affinity return codes.

**Frontend (Vitest + RTL + jsdom + `mockIPC`; vitest-axe):**
- onboarding validation, the lock screen error, the lock event clearing the cache;
- SecretField reveal/auto-hide/unmount clear, and the copy toast countdown and cancel;
- account form zod validation and tri-state secret editing;
- delete and bulk-delete confirmations;
- filter chips mapping to the query DSL, and saved views;
- the graph mapper as a pure function, and list fallback keyboard navigation;
- the generator UI constraint toggles;
- an empty state for every route, StatusBadge text/icon presence, and axe checks per page;
- an ESLint rule test ensuring no web storage.

**E2E (Phase 16):** `tauri-driver` + WebdriverIO on Windows for the happy-path smoke. Optional Playwright against Vite with mocked IPC for UI regression.

**Spec negative tests mapped:**
- Wrong password → Phase 3/4.
- Corrupted vault (header and DB) → Phase 3.
- Missing fields → Phase 7/8.
- Invalid imports → in the MVP this means an invalid or tampered backup file and an unknown-version vault (Phases 3 and 14). Real import parsers come in Phase 2 of the roadmap.
- Import/export warnings → covered once CSV is built; for the MVP, a test asserts that no CSV export command is registered.

**CI (windows-latest):** fmt, clippy `-D warnings`, `cargo test`, `cargo deny` (advisories, licenses, network-crate bans), `cargo audit`, `npm run lint && typecheck && test`, and a release-config check (CSP has no `unsafe-eval`/`unsafe-inline` for script, devtools off).

---

## 7. Documentation Deliverables and Timing

| Doc (in `docs/`) | First written | Updated | Final |
|---|---|---|---|
| `README.md` (repo root) | P0 | every phase | P16 |
| `architecture.md` | P1 | P3, P5, P7, P11 | P16 |
| `threat-model.md` (protects / does not protect, as honest as the spec) | P0 draft | P3 (crypto), P5 (OS integrations, clipboard caveats) | P16 |
| `security-assumptions.md` (library trust, memory-hygiene limits, WebView2, clipboard managers) | P3 | P5, P7 | P16 |
| `vault-format.md` (header, envelope, versioning, pinned SQLCipher settings) | P3 | P14 (backup container), P15 | P16 |
| `local-data-storage.md` (every file the app writes: vault, app config, logs, WebView2 folder) | P3 | P4, P14 | P16 |
| `privacy-statement-draft.md` (source for onboarding and settings copy) | P4 | P15 | P16 |
| `forgot-master-password.md` | P4 | none | P16 |
| `backup-restore.md` | P14 | P15 (password-change caveat) | P16 |
| `design-system.md` | P2 | P4, P13 | P16 |
| `future-extension-sync-checklist.md` (preconditions for any sync or extension: vault correctness, threat-model update, key-slot design, conflict model, E2E encryption only, opt-in) | P14 | none | P16 |
| `adr/000N-*.md` | P0 onward | as decisions are made | continuous |
| `SECURITY.md` (disclosure) | P16 | none | P16 |

---

## 8. Open Questions and Decisions (with recommendations)

1. **Vault layout: folder (header + DB) or single file?** Recommend a **folder** for the MVP. SQLCipher needs a real file, the header must be readable pre-unlock, and backups are single-file anyway. Option C from §2.1 would allow a single file if you value that more.
2. **Default vault location.** Recommend **`%LOCALAPPDATA%\Vaultair\Vaults`**, not Documents. Your Documents is OneDrive-synced, which would silently upload the (encrypted) vault and conflict with "never uploaded by default". Warn whenever a cloud-synced path is chosen.
3. **Master password policy.** Recommend at least 12 characters **and** zxcvbn score ≥ 3, with no override. Encourage passphrases, set no maximum length, and normalize to NFC.
4. **Argon2id parameters.** Recommend calibrating to about 1 s, clamped to 64–512 MiB, t = 3, p = 4. Store the parameters in the header and offer "Strengthen KDF" later.
5. **TOTP in the MVP?** The spec lists "copy TOTP" in the MVP but puts TOTP generation in roadmap Phase 2. Recommend **including code generation** (`totp-rs`, a small Rust-only addition that returns the current code plus seconds remaining, and a copy that auto-clears). The alternative is relabelling the MVP to "store TOTP secret" and dropping "copy TOTP".
6. **Screen-capture protection default.** Recommend **On by default**. The audience streams and screen-shares often, and the toggle stays easy to reach.
7. **Restore in the MVP?** Deliverable 15 only says "create". Recommend **including verify and "restore to new location"**: a backup that has never been restored isn't trustworthy.
8. **Change master password in D16?** Recommend yes (re-wrap only, with a clear warning about old backups). Defer "Rotate encryption key" to post-MVP, but design for it now.
9. **Index regular notes in FTS?** Recommend yes for normal notes. Provide a separate "Sensitive notes" field that's encrypted and never indexed.
10. **Quick unlock (Windows Hello/DPAPI).** Recommend **defer** to roadmap Phase 2, master password only in the MVP. The key-slot header design keeps this open.
11. **Default auto-lock and reveal timeouts.** Recommend a 5 min inactivity lock (lock on session lock and sleep on, minimize off), clipboard clear at 30 s, and reveal auto-hide at 20 s.
12. **Phone numbers.** Recommend storing a *reference* ("Pixel, ends 42") by default rather than full numbers, because it reduces sensitivity. Allow a full number if the user wants it.
13. **Typed IPC bindings.** Recommend tauri-specta, with ts-rs as the fallback.
14. **Distribution and code signing.** An unsigned security app triggers SmartScreen warnings, which hurts trust. Recommend an OV/EV certificate (or Azure Trusted Signing) before any public release. Unsigned is fine for private beta.
15. **Auto-updates.** Recommend none in the MVP, because the no-network promise matters. Revisit later with signed updates and an explicit opt-in.
16. **License / open source.** Open-sourcing materially helps trust for a local vault. Your call. Recommend deciding before the first public build.
17. **Multiple vaults.** Recommend one open vault at a time, with a recent-vaults switcher.

---

## 9. Spec Items to Defer or Flag (not decided here)

- **"Smurf" as a default purpose label.** Several major publishers' terms or policies discourage or prohibit smurfing, and the spec's non-goals exclude ban evasion. Seeding it as a built-in could read as endorsing it. Options: (a) keep it as a built-in; (b) don't seed it, but let users create it as a custom label; (c) rename or reframe it (e.g. fold into "Alt"). **Flagged for your decision.**
- **"Shared household" purpose.** Some platforms prohibit account sharing. This is lower risk than Smurf (it can be legitimate), but worth a conscious decision.
- **"Copy TOTP" (MVP) vs TOTP generation (roadmap Phase 2).** These contradict each other; see §8.5.
- **Attachments and activity history** appear in the account-detail layout but are roadmap Phase 2. Recommend hiding those panels or showing a subtle "Coming later", and reserving layout space.
- **CSV export.** The spec says "disabled or buried". Recommend **not implementing it in the MVP at all**, rather than burying it, and asserting its absence in tests. Import/export warning tests move to the phase where import is built.
- **"Invalid imports" negative test.** No import exists in the MVP. It's reinterpreted as invalid backup and vault files (§6).
- **"Open official login pages."** Built-in catalog URLs need upkeep and could go stale or be wrong. Recommend labelling them as catalog-provided, making them user-editable, and showing a confirm dialog with the domain. The app must never auto-fill or auto-login, which is consistent with the non-goals.
- **"Last verified."** It must be a manual "Mark verified" action. Any automated verification would mean logging in to platforms, which the non-goals prohibit.
- **"High-priority" saved view.** The spec doesn't define it. Suggest: favorites, plus Main/Recovery purposes, plus accounts with high-severity health issues. Needs your confirmation.
- **Recovery checklist.** It must not include a "password hint" or any stored recovery material. It should be guidance only.
- **Breach checks, browser extension, autofill, sync.** Explicitly out of the MVP. The sync/extension checklist doc (§7) gates them.
- **Password-strength metadata.** Storing the score and fingerprint is a small metadata leak *inside* the encrypted DB. It's acceptable, but document it in security-assumptions.md.
- **Design-skill fit.** `design-taste-frontend` excludes dashboards and tables, and its default dials suit landing pages. The plan scopes it to direction, onboarding, lock screen and empty states, and gives the product views to `ui-ux-pro-max`. Also check that the skill loads from `.agents\skills\`.

---

## Success Criteria (MVP)
- [ ] You can create a vault through the onboarding flow and lock and unlock it. It locks on Win+L, sleep and inactivity.
- [ ] Passwords, TOTP secrets and recovery codes are ciphertext in the DB, absent from FTS, DTOs, logs and backups-in-plaintext, and never reach JS on copy.
- [ ] Copied items are excluded from Win+V history and cloud clipboard, and auto-clear at 30 s unless cancelled.
- [ ] Accounts, identities, custom purposes, games/platforms, game profiles, MFA and connections are all manageable. Search finds records by fragment in under 50 ms at 5k records.
- [ ] Health dashboard: weak, reused, missing MFA and missing recovery codes are correct, and every issue links to its fix.
- [ ] The relationship map and its list fallback render the spec's example tree.
- [ ] Encrypted backups can be created, verified and restored. Settings cover the timeouts, privacy options and master-password change.
- [ ] The canary suite, negative tests and CI (clippy, deny, audit, Vitest) are green on Windows. All §7 docs exist.

**Relevant paths:**
- `C:\Users\theba\OneDrive\Documents\Fun_(SWE)\vaultair\` (project root; relocation recommended)
- `C:\Users\theba\OneDrive\Documents\Fun_(SWE)\vaultair\.agents\skills\design-taste-frontend\SKILL.md`
- `C:\Users\theba\OneDrive\Documents\Fun_(SWE)\vaultair\.claude\skills\ui-ux-pro-max\SKILL.md`
- `C:\Users\theba\OneDrive\Documents\Fun_(SWE)\vaultair\skills-lock.json`