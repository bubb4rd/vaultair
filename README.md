# Vaultair

[![CI](https://github.com/bubb4rd/vaultair/actions/workflows/ci.yml/badge.svg)](https://github.com/bubb4rd/vaultair/actions/workflows/ci.yml)

**Vaultair** is a local-first, encrypted workspace for Windows. It helps you manage gaming and online identities—accounts, logins, recovery codes, MFA, and how they connect—in one vault on your own disk. There is no cloud account and no network traffic from the app.

> **Status:** MVP features (Phases 0–15b) are implemented. Release hardening (Phase 16) is largely done; an installer, full smoke test, and code signing for public release are still open. Run Vaultair from a source build until installers ship. See [`docs/phase-notes.md`](docs/phase-notes.md) for the build log and open items.

## Features

- **Encrypted vault on disk** — SQLCipher database, Argon2id key derivation, encrypted backups with integrity checks
- **Accounts and identities** — platforms, games, purposes, favorites, archives, and a built-in catalog
- **Secrets and MFA** — passwords, TOTP, backup codes, generator (passwords and EFF passphrases), reveal with auto-hide
- **Search and views** — full-text search (secrets never indexed), filters, saved views, bulk actions
- **Security health** — weak/reused passwords, missing MFA, dormant accounts, and fix shortcuts
- **Relationship map** — see how identities, emails, accounts, and platforms connect
- **Windows integration** — idle/session lock, protected clipboard, optional capture protection, Windows Hello quick unlock, system tray

Autofill, sync, and browser extensions are intentionally out of scope for the MVP ([ADR-0004](docs/adr/0004-mvp-scope-decisions.md)).

## Quick start (development)

Vaultair is **Windows-only** today. You need Rust (MSVC), Node.js LTS, WebView2, and [Strawberry Perl](https://strawberryperl.com/) on `PATH` for the vendored SQLCipher build (see [Prerequisites](#prerequisites-windows) below).

```powershell
npm install
npm run tauri dev
```

Release binary (no installer bundle):

```powershell
npx tauri build --no-bundle
# → target\release\vaultair.exe
```

## Prerequisites (Windows)

| Tool | Notes |
|---|---|
| Rust stable, `x86_64-pc-windows-msvc` | via [rustup](https://rustup.rs/) |
| MSVC Build Tools (VS 2022, “Desktop development with C++”) | |
| Node.js LTS + npm | |
| WebView2 runtime | included on Windows 10/11 |
| **Strawberry Perl** | `winget install StrawberryPerl.StrawberryPerl` — required for vendored OpenSSL/SQLCipher; Git’s MSYS Perl does not work |

## Development

```powershell
npm run tauri dev              # app with hot reload
cargo test --workspace         # Rust tests (regenerates src/ipc/bindings.ts when needed)
npm test -- --run              # frontend tests
npm run lint; npm run typecheck
npm run check:release-config
cargo deny check               # cargo install cargo-deny --locked
npx tauri build --no-bundle
```

After changing IPC commands, run `cargo test -p vaultair` and commit any updates to `src/ipc/bindings.ts`. CI runs fmt, clippy, tests, dependency and license checks, and a guard against committing vault files (`*.vdb`, `*.vhdr`, `*.vaultair-backup`).

## Documentation

| Doc | Description |
|---|---|
| [`docs/product-spec.md`](docs/product-spec.md) | Product specification |
| [`docs/architecture.md`](docs/architecture.md) | Layers and security baseline |
| [`docs/vault-format.md`](docs/vault-format.md) | On-disk vault format |
| [`docs/backup-restore.md`](docs/backup-restore.md) | Encrypted backups |
| [`docs/threat-model.md`](docs/threat-model.md) | Threat model (draft) |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Phased build plan |
| [`docs/phase-notes.md`](docs/phase-notes.md) | Phase-by-phase implementation log |
| [`SECURITY.md`](SECURITY.md) | Reporting vulnerabilities |

## Security

Please report security issues through [GitHub private vulnerability reporting](https://github.com/bubb4rd/vaultair/security/advisories/new) as described in [`SECURITY.md`](SECURITY.md). Do not open public issues for vulnerabilities.

## License

Source in this repository is **proprietary** (all rights reserved). Third-party components retain their own licenses; see Settings → About in the app and [Third-party content](#third-party-content) below.

## Third-party content

- Platform and game logos: [Simple Icons](https://simpleicons.org) (CC0); trademarks belong to their owners
- Database: [SQLCipher](https://www.zetetic.net/sqlcipher/) (BSD-style)
- UI font: [Geist](https://vercel.com/font) (SIL OFL 1.1)
- Graph layout: [@dagrejs/dagre](https://github.com/dagrejs/dagre) (MIT)
- Passphrase wordlist: [EFF large wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) ([CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/))
