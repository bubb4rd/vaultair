<p align="center">
  <a href="https://github.com/bubb4rd/vaultair">
    <img src="src-tauri/icons/icon.png" alt="Vaultair" width="128" height="128">
  </a>
</p>

<h1 align="center">Vaultair</h1>

<p align="center">
  <a href="https://github.com/bubb4rd/vaultair/actions/workflows/ci.yml">
    <img src="https://github.com/bubb4rd/vaultair/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>
Vaultair is an encrypted, local-first Windows app for managing gaming and online accounts. Keep passwords, recovery codes, MFA, and the connections between your identities in one vault on your own disk.

No cloud account. No network traffic from the app.

## Project status

The MVP is implemented. Release hardening is mostly complete, but the installer, full smoke test, and code signing are still pending.

For now, build and run Vaultair from source. See [the development log](docs/phase-notes.md) for completed work and remaining release tasks.

## Features

- Encrypted storage — SQLCipher database, Argon2id key derivation, and encrypted backups with integrity checks.
- Account organization — group accounts by platform, game, or purpose; mark favorites and archive unused accounts.
- Passwords and MFA — store passwords, TOTP, and backup codes; generate passwords and EFF passphrases; reveal secrets with automatic hiding.
- Search and saved views — full-text search, filters, saved views, and bulk actions. Secrets are never indexed.
- Security checks — find weak or reused passwords, accounts without MFA, and dormant accounts, with shortcuts to address them.
- Relationship map — see how identities, email addresses, accounts, and platforms connect.
- Windows integration — idle and session locking, protected clipboard, optional capture protection, Windows Hello quick unlock, and system tray support.

Autofill, sync, and browser extensions are outside the MVP scope. See [the scope decisions](docs/adr/0004-mvp-scope-decisions.md).

## Build and run

Vaultair currently supports Windows only.

### Prerequisites

| Tool | Notes |
| --- | --- |
| Rust stable | Install through [rustup](https://rustup.rs/) using the `x86_64-pc-windows-msvc` toolchain. |
| Visual Studio 2022 Build Tools | Install the “Desktop development with C++” workload. |
| Node.js LTS and npm | Required for the frontend and build tooling. |
| WebView2 runtime | Required to run the app. |
| [Strawberry Perl](https://strawberryperl.com/) | Must be on `PATH` for the vendored OpenSSL/SQLCipher build. Git’s MSYS Perl does not work. |

Install Strawberry Perl with:

```powershell
winget install StrawberryPerl.StrawberryPerl
```

### Run in development

From the repository root:

```powershell
npm install
npm run tauri dev
```

### Build a release executable

```powershell
npx tauri build --no-bundle
```

The executable is written to `target\release\vaultair.exe`. This does not create an installer.

## Development

### Tests and checks

```powershell
# Rust tests
cargo test --workspace

# Frontend tests
npm test -- --run

# Lint and type checks
npm run lint
npm run typecheck

# Release configuration
npm run check:release-config

# Dependency and license checks
cargo deny check
```

Install `cargo-deny` if needed:

```powershell
cargo install cargo-deny --locked
```

After changing IPC commands, run:

```powershell
cargo test -p vaultair
```

Commit any generated changes to `src/ipc/bindings.ts`.

CI runs formatting, Clippy, tests, dependency checks, and license checks. It also checks for accidentally committed vault files: `*.vdb`, `*.vhdr`, and `*.vaultair-backup`.

## Documentation

| Document | Covers |
| --- | --- |
| [Product specification](docs/product-spec.md) | Product requirements and scope |
| [Architecture](docs/architecture.md) | Application layers and security baseline |
| [Vault format](docs/vault-format.md) | On-disk storage format |
| [Backup and restore](docs/backup-restore.md) | Encrypted backups |
| [Threat model](docs/threat-model.md) | Security assumptions and threats; currently a draft |
| [Implementation plan](docs/implementation-plan.md) | Phased development plan |
| [Development log](docs/phase-notes.md) | Implementation progress and open tasks |
| [Security policy](SECURITY.md) | How to report vulnerabilities |

## Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/bubb4rd/vaultair/security/advisories/new).

Do not open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for reporting details.

## License

The source code in this repository is proprietary. All rights reserved.

Third-party components retain their own licenses. See the list below and Settings → About in the app.

## Third-party content

| Component | License / attribution |
| --- | --- |
| Platform and game logos from [Simple Icons](https://simpleicons.org) | CC0; trademarks belong to their respective owners |
| [SQLCipher](https://www.zetetic.net/sqlcipher/) | BSD-style |
| [Geist](https://vercel.com/font) UI font | SIL OFL 1.1 |
| [@dagrejs/dagre](https://github.com/dagrejs/dagre) graph layout | MIT |
| [EFF large wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) | [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/) |
