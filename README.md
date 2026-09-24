# Vaultair

A local-first, encrypted Windows workspace for people who manage several gaming and online identities: accounts, identities, recovery codes, MFA and how they all connect, in one vault on your own disk. No cloud account, no network.

> **Status:** Phase 1 (hardened Tauri + React shell). Next: Phase 2, the dark app shell and design system.
> Proprietary. All rights reserved.

## Docs

| Doc | What it is |
|---|---|
| [`docs/product-spec.md`](docs/product-spec.md) | Original product spec |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Architecture, crypto design, schema, and the phased build order (Phases 0–16) |
| [`docs/architecture.md`](docs/architecture.md) | Layers, security baseline, manual release checks |
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
- **Phase 3 note:** on a wrong key, SQLCipher logs `hmac check failed` to stderr. Set `PRAGMA cipher_log_level = NONE` (or route it through tracing) so the error handling stays in our code.
