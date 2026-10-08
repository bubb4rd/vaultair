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

The MVP is implemented, and the first build, [v0.1.0](https://github.com/bubb4rd/vaultair/releases/tag/v0.1.0), is out as a pre-release for testers. The installer is not code-signed yet and the end-to-end smoke test is not automated; both are planned before a general release.

See [the development log](docs/phase-notes.md) for completed work and remaining release tasks.

## Install

Vaultair runs on 64-bit Windows 10 and 11.

1. Download `Vaultair_<version>_x64-setup.exe` from the [Releases page](https://github.com/bubb4rd/vaultair/releases). Builds are published there and nowhere else.
2. Run it. The installer is not code-signed yet, so Windows SmartScreen shows “Windows protected your PC”. Choose **More info**, then **Run anyway**. Your browser may also ask whether to keep the download.
3. Follow the installer. It installs for your Windows account only and does not ask for administrator rights.

To check a download before running it, compare its SHA-256 with the one in the release notes:

```powershell
Get-FileHash .\Vaultair_0.1.0_x64-setup.exe -Algorithm SHA256
```

The installer is about 220 MB because it carries Microsoft’s WebView2 runtime, so setup does not have to download it.

### Updating

Vaultair makes no network connections, so it cannot check for updates or install them. To update, download the newer installer from the Releases page and run it. Your vaults and settings are left as they are; making a backup first (Settings → Backups) is still a good habit.

### Uninstalling

Uninstall from Windows Settings → Apps. This removes the program only. Vaults, backups, and settings stay on disk; [Local data storage](docs/local-data-storage.md) lists where they are and how to remove them.

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

This section is for building from source rather than installing a release. Vaultair currently supports Windows only.

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

To build the installer as well, leave out `--no-bundle`; it is written to `target\release\bundle\nsis\`. Published installers are built by GitHub Actions from a version tag: see [Releasing](docs/release.md).

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

# Release configuration and version
npm run check:release-config
npm run check:release-version

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
| [Releasing](docs/release.md) | Version bumps, tags, the installer build, and code signing plans |
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
