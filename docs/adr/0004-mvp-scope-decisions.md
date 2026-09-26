# ADR-0004: MVP scope and product decisions

- **Status:** Accepted
- **Date:** 2026-09-23
- **Decided by:** project owner, from the open questions in `docs/implementation-plan.md` §8 and §9

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | "Smurf" purpose label | **Not seeded as a built-in.** Users can create it as a custom label. Built-ins: Main, Competitive, Ranked, Casual, Alt, Creator, Testing (+ custom). Rationale: the spec's non-goals exclude ban evasion, and several publishers prohibit smurfing; the app shouldn't appear to endorse it. |
| 2 | TOTP in the MVP | **Include TOTP code generation** (`totp-rs`, Rust only): current code, seconds remaining, auto-clearing copy. Resolves the spec's "copy TOTP" vs roadmap conflict. |
| 3 | Default vault location | **`%LOCALAPPDATA%\Vaultair\Vaults`**, with a warning when a cloud-synced folder is chosen. |
| 4 | Master password policy | **At least 12 characters and zxcvbn score ≥ 3, no override.** No maximum length; NFC normalised; passphrases encouraged. No password hints. |
| 5 | Argon2id parameters | Calibrate to about 1 s; m 64–512 MiB, t = 3, p = 4; stored in the header. |
| 6 | Screen-capture protection | **On by default**, easy to toggle in Settings. |
| 7 | Backup restore | **In the MVP:** create, verify, and restore to a new location. |
| 8 | Change master password | **In the MVP** (DEK re-wrap, with a warning about old backups). "Rotate encryption key" is post-MVP. |
| 9 | Full-text search over notes | Normal notes indexed; a separate encrypted "Sensitive notes" field is never indexed. |
| 10 | Windows Hello / quick unlock | ~~Deferred.~~ **Superseded by [ADR-0005](0005-quick-unlock.md) (2026-09-25):** opt-in Windows Hello quick unlock in Phase 15b, with the master password still required after a restart, every 7 days and for sensitive actions. |
| 11 | Timeouts | Auto-lock after 5 min inactivity; lock on Windows session lock and sleep (on), on minimize (off). Clipboard clears at 30 s. Revealed secrets hide at 20 s. |
| 12 | Phone numbers | Store a reference ("Pixel, ends 42") by default; a full number is optional. |
| 13 | Typed IPC | tauri-specta, with ts-rs as the fallback. |
| 14 | Code signing | Unsigned for private beta; OV/EV or Azure Trusted Signing before any public release. |
| 15 | Auto-updates | **None in the MVP** (no-network promise). |
| 16 | License | **Closed source (proprietary).** All rights reserved; no open-source license file. |
| 17 | Multiple vaults | One open at a time, with a recent-vaults switcher. |
| 18 | CSV export | **Not implemented in the MVP**; tests assert its absence. |
| 19 | "High-priority" saved view | Favorites + accounts with the Main or Recovery purpose + accounts with high-severity health issues. |
| 20 | Favorites (2026-09-24) | **A sidebar section, not a page.** Starred accounts are listed directly in the sidebar under "Favorites" (after the Vault group), in the order they were starred; there is no Favorites route. Empty until accounts exist (Phase 7). |

## Still open

- **"Shared household" purpose label.** Some platforms prohibit account sharing. Decide before Phase 9 (purpose labels) whether it's a built-in or custom-only.

## Also recorded (plan §9 recommendations, adopted with the defaults)

- Attachments and activity history panels: hidden in the MVP, with layout space reserved.
- "Open official login page": catalog URLs are user-editable, and opening one shows a confirm dialog with the domain. No auto-fill or auto-login, ever.
- "Last verified" is a manual action only.
- The recovery checklist is guidance only and stores no recovery material or hints.
- Breach checks, browser extension, autofill and sync are out of the MVP.
- Storing password strength and HMAC fingerprints inside the encrypted DB is an accepted small metadata leak, documented in `security-assumptions.md` (Phase 3).

## Consequences

- The purpose-label seed data and tests in Phase 9 follow decision 1.
- Closed source means the trust story relies on documentation (threat model, security assumptions, vault format) rather than public code review. Consider a third-party review before public release.
