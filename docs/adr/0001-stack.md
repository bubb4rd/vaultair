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
