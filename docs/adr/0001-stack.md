# ADR-0001: Application stack

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

Vaultair is a local-first, Windows-first encrypted workspace for people who manage several gaming and online identities (see `docs/product-spec.md`). It needs a native desktop feel, a premium UI, a small attack surface, and a trustworthy home for cryptography.

## Decision

- **Shell:** Tauri v2 on Windows (WebView2).
- **Core:** Rust, split into a Cargo workspace:
  - `crates/vaultair-core`: pure Rust, `#![forbid(unsafe_code)]`, no Tauri dependency. Owns crypto, vault format, database, domain rules, search, health, graph, generator and backup.
  - `crates/vaultair-platform`: the only crate allowed `unsafe`. Traits plus Windows implementations (clipboard exclusion, session-lock events, capture protection).
  - `src-tauri`: a thin command layer (validation, DTO mapping, error sanitising).
- **Frontend:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, Tailwind v4, shadcn/ui (Radix), TanStack Router/Query/Table/Virtual, Zustand for UI-only state, react-hook-form + zod.
- **IPC types:** generated with tauri-specta (pinned); `ts-rs` is the fallback.
- **Trust boundary:** all cryptography and secret handling lives in Rust. Copy-to-clipboard never sends the secret to JS. Only an explicit reveal returns a secret to the UI, and a dedicated `RevealedSecret` newtype is the only secret type that can serialize.
- **Plugins:** `dialog` and `single-instance` only (plus optional `window-state`). No `fs`, `shell`, `http`, `store`, `updater`, or `log` plugins; `deny.toml` bans them along with network client crates.
- **Toolchain:** Rust stable (MSVC target), Node LTS, MSVC Build Tools, WebView2, Strawberry Perl (for vendored OpenSSL, see ADR-0002).

## Consequences

- The UI can be treated as semi-untrusted: a webview compromise still cannot bulk-read secrets without going through audited commands.
- Two languages and a C dependency (SQLCipher/OpenSSL) raise build complexity; CI builds on `windows-latest` to catch it early.
- The frontend cannot use browser storage, `fetch`, or `console` in release; ESLint and Vite settings enforce this.

Full detail: `docs/implementation-plan.md` §1.

## As built (checked in Phase 16)

The decision stands. Where the code differs from the list above:

- **Plugins:** `single-instance` only. `tauri-plugin-dialog` was dropped because it depends on `tauri-plugin-fs`; the folder and file pickers are native code in `vaultair-platform`. `window-state` was not added. The tray icon is Tauri's own `tray-icon` feature.
- **`deny.toml`** bans the network client crates and the `http`, `updater`, `shell` and `fs` plugins. It does not list `store` or `log`. `scripts/check-release-config.mjs` refuses their permissions in the capability file instead, with `opener` and `clipboard-manager`.
- **Frontend:** TanStack Router, Query and Virtual are used. TanStack Table, Zustand, react-hook-form and zod are not dependencies: there is no table, store, form or schema library, and Rust validates. Icons are Phosphor.
- **Trust boundary:** three response types carry a secret value to the UI, not one: `RevealedSecret`, `TotpCodeView` (the current TOTP code) and `Generated` (a new password). `src-tauri/src/ipc.rs` pins which commands may return them and holds a reviewed list of every command's return type. A shown secret is not selectable text (`user-select: none` on the page); as a backstop, a copy, cut or drag whose selection touches one is intercepted in the page and sent through the same Rust clipboard path as the Copy button or dropped. The backstop is tested in the test DOM only.
- **`vaultair-platform`** also holds the Windows Hello, DPAPI and TPM code for quick unlock (ADR-0005), and the native pickers.
