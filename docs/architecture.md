# Vaultair architecture

> **Status:** Phase 5 (auto-lock, session lock, clipboard, capture protection). Phase 1 set the security baseline below; the vault format is in `docs/vault-format.md`. Updated in Phases 3, 5, 7 and 11. Design rationale is in `docs/adr/`; the full target design is in `docs/implementation-plan.md` §1.

## Layers

```
WebView2  ── React + TS (src/)             renders DTOs, no storage, no network
   │  IPC (invoke, typed via tauri-specta → src/ipc/bindings.ts)
src-tauri ── command layer                 validation, DTO mapping, error sanitising
   │
crates/vaultair-core      pure Rust, #![forbid(unsafe_code)], no Tauri
crates/vaultair-platform  OS integrations; the only crate with `unsafe` (windows module)
```

| Path | Holds |
|---|---|
| `crates/vaultair-core/src/error.rs` | `AppError`: serializes to `{ code, message, field? }` with fixed messages; carries only static strings |
| `crates/vaultair-core/src/crypto/` | Argon2id KDF (floors/caps, calibration), XChaCha20-Poly1305, HKDF key hierarchy (`VaultKeys`, zeroized, redacted Debug), field envelopes, fingerprints, master password policy |
| `crates/vaultair-core/src/vault/` | Header encode/decode, layout, `.lock`, atomic writes, `create_vault` / `open_vault`, `VaultError` |
| `crates/vaultair-core/src/db/` | SQLCipher open with pinned pragmas, integrity checks, `user_version` migrations, `V1__init.sql` |
| `crates/vaultair-core/src/service/session.rs` | Lock/unlock state machine; one vault open at a time; slow work outside the mutex. Owns the idle deadline (`touch`, `lock_if_idle`) and `SessionConfig` (ADR-0004 defaults) |
| `crates/vaultair-core/src/config.rs` | App config (`config.json`): the recent-vaults list (paths only) and the capture-protection switch; atomic writes; unreadable = defaults |
| `crates/vaultair-core/src/vault/location.rs` | Cloud-synced folder classifier for the onboarding warning |
| `src-tauri/src/commands/vault.rs` | `vault_kdf_calibrate`, `vault_create`, `vault_create_demo`, `vault_unlock`, `vault_lock`, `vault_status`, `vault_integrity_check`, `vault_location_check`, `vault_pick_folder` (Argon2/SQLCipher/dialogs on blocking threads) |
| `src-tauri/src/commands/{recent,password}.rs` | `recent_vaults_list/forget`; `strength_estimate` (zxcvbn in Rust, so the UI and the enforced policy agree) |
| `src-tauri/src/events.rs` | `vault://locked` and `clipboard://cleared` |
| `src-tauri/src/lock.rs` | `Locker`: the one lock path (manual, idle, OS events, exit). Closes the vault, clears our clipboard value, emits `vault://locked`. Also the lock policy per OS event and the 1 s idle check |
| `src-tauri/src/clipboard.rs` | `ClipboardService`: copy, timed clear (tokio), keep, clear now; a clear only removes our own value |
| `src-tauri/src/state.rs` | `AppState`, built in `setup` once the window exists (the platform objects need its HWND); applies capture protection and subscribes to session events at launch |
| `src-tauri/src/commands/{session,clipboard}.rs` | `session_touch`, `session_config_get`, `capture_protection_set`, `session_take_lock_notice`; `clipboard_copy_plain`, `clipboard_cancel_clear`, `clipboard_clear_now` |
| `crates/vaultair-core/src/redact.rs` | `Redacted<T>`, `redact_email`, `redact_username` for anything that might reach logs |
| `crates/vaultair-platform/src/lib.rs` | `Clipboard`, `SessionEvents`, `CaptureProtection` traits; the `fake` feature has in-memory versions for tests |
| `crates/vaultair-platform/src/windows/` | WebView2 settings hardening (COM); native folder picker (`IFileOpenDialog`); clipboard with history exclusion (`clipboard.rs`); WTS and power events from subclassing the main window (`session.rs`); display affinity (`capture.rs`) |
| `src-tauri/src/ipc.rs` | The command list; generates `src/ipc/bindings.ts` |
| `src-tauri/src/window.rs` | Creates the main window in Rust; navigation allow-list |
| `src-tauri/src/logging.rs` | File logging and the panic hook |
| `src/ipc/client.ts` | The only module the UI uses for IPC; normalises all rejections to `IpcError` |
| `src/features/shell/ActivityTracker.tsx` | Pings `session_touch` on pointer and keyboard activity, at most every 15 s, with a trailing ping |
| `src/features/toast/toast.ts`, `src/components/common/Toaster.tsx` | App-wide toasts (success, error, warning, info; shortcut keycaps, actions, countdown), rendered once at the app root |
| `src/features/clipboard/copy.ts` | `copyToClipboard`: the copy toast with countdown, "Keep in clipboard" and "Clear now" |
| `src/features/lock/lockNotice.ts` | On the lock screen, shows why the vault locked (`session_take_lock_notice`, one-shot, kept in Rust because the webview reloads) |
| `src/app/lock-guard.tsx` | `VaultGate`: renders onboarding, the lock screen, or the router only when Rust reports an unlocked vault; on `vault://locked` clears the query cache and reloads the webview |

## Security baseline (Phase 1)

**Webview**
- CSP (release): `script-src 'self'`, `style-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src/base-uri/form-action/frame-src/frame-ancestors 'none'`. The dev CSP adds only `'unsafe-inline'` styles and the Vite websocket, and is never shipped.
- `freezePrototype: true`, `withGlobalTauri: false`.
- The window is created in Rust, not `tauri.conf.json`, so the navigation guard is always attached. Only `http://tauri.localhost` (and the Vite dev server in debug builds) may load; everything else is refused and logged.
- Drag-and-drop is disabled.
- Radix dialogs inject a scroll-lock `<style>` tag that `style-src 'self'` blocks. It is harmless (the body never scrolls), so the CSP is not loosened. See `docs/design-system.md`.
- WebView2 settings: password autosave and general autofill off, status bar, zoom, pinch and swipe navigation off, host objects off, built-in error pages off. In release, devtools, the default context menu and browser accelerator keys (F5, Ctrl+P, Ctrl+F, Ctrl+Shift+I) are also off.

**IPC and permissions**
- App commands are declared in `src-tauri/build.rs`; each needs an explicit `allow-*` entry in `src-tauri/capabilities/main.json`.
- Vault commands each have an `allow-vault-*` permission. Failed commands return `IpcError { code, message, field? }` with fixed messages; the static cause is logged.
- Current capability: window controls for the frameless window (minimize, toggle/internal-toggle maximize, is-maximized, close, start-dragging, unminimize), `core:event:default`, `allow-app-info`.
- Plugins: `single-instance` only. A second launch focuses the existing window.
- No dialog plugin: `tauri-plugin-dialog` depends on `tauri-plugin-fs`, which `deny.toml` bans. Folder picking is a Rust command (`vault_pick_folder`) calling `IFileOpenDialog` in `vaultair-platform`, so the webview gets no file-system API and Rust validates every chosen path.
- Typed bindings are regenerated by `cargo test -p vaultair` (test `ipc::tests::export_bindings`); CI fails if the committed file is stale.

**Lock and unlock (Phase 4)**
- Startup: `vault_status` and `recent_vaults_list`. Unlocked shows the app; locked shows the lock screen if any vault is known, otherwise onboarding.
- Lock (sidebar button, Ctrl+L, idle, Win+L, sign-out, disconnect, sleep, exit; minimize if enabled): every path goes through `lock::Locker`, which drops the open vault (closes SQLCipher, zeroizes keys, releases `.lock`), clears our clipboard value and emits `vault://locked`. The UI clears the query cache and reloads the webview, discarding the JS heap. The hash route survives the reload.
- The master password is held only in the lock screen's or onboarding's component state, is sent once per unlock/create, and is cleared after. `strength_estimate` receives it while typing (debounced) and drops it.
- Lock-screen backoff after 5 wrong attempts (5, 10, 20, 40, 60 s) is cosmetic; Argon2 is the real rate limit.

**Auto-lock, clipboard and capture protection (Phase 5)**
- Idle: Rust owns the deadline (`SessionManager::lock_if_idle`, checked every second). The UI's `ActivityTracker` sends `session_touch` on pointer and keyboard activity, at most every 15 s, with a trailing ping so the lock is never more than one interval early. Default 5 min.
- OS events: `vaultair-platform` subclasses the main window (`SetWindowSubclass`) and registers for WTS notifications. Session lock, sign-out and disconnect lock by default, as does sleep (`PBT_APMSUSPEND`); minimize doesn't. Shutdown (`WM_QUERYENDSESSION`) always locks. Sleep and shutdown lock synchronously on the UI thread so they finish first; the rest run on a blocking thread.
- Clipboard: one `OpenClipboard` session writes `CF_UNICODETEXT` plus `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` = 0 and `CanUploadToCloudClipboard` = 0, then records `GetClipboardSequenceNumber`. The clear (timer, "Clear now", lock, exit) runs only if the sequence number is unchanged, so a later copy by the user is never wiped. `OpenClipboard` retries for about 0.75 s. `clipboard_copy_plain` is for non-secret text the UI already shows and is refused while locked; secrets will use `clipboard_copy_secret` (Phase 7), which never sends the value to JS.
- Capture protection: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, falling back to `WDA_MONITOR` before Windows 10 2004. On by default, stored in `config.json` so it applies to the lock screen at launch.

**Errors and logs**
- The UI only ever sees `{ code, message, field? }`. `src/ipc/client.ts` turns anything else (runtime errors, ACL denials) into the generic internal error, so raw error text never reaches the screen.
- Logs: `%LOCALAPPDATA%\Vaultair\logs\vaultair.YYYY-MM-DD.log`, INFO and above, daily rotation, 7 files kept. Nothing is printed to stdout/stderr (clippy denies `println!`/`eprintln!`/`dbg!`).
- The panic hook logs the file and line only, never the panic message.

**Build-time guards**
- `deny.toml` bans network client crates and unneeded Tauri plugins. Verified 2026-09-23: adding `reqwest` fails `cargo deny check`.
- `scripts/check-release-config.mjs` fails CI if the CSP gains `unsafe-eval`/inline scripts/inline styles or broad sources, if `freezePrototype`/`withGlobalTauri` change, if the `devtools` feature is enabled, or if a banned or broad `:default` permission is granted.
- ESLint bans `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `new Function`, `dangerouslySetInnerHTML` and `console`. Release bundles also strip `console`/`debugger`.

## Manual verification (release build)

Run `npx tauri build --no-bundle`, then `target\release\vaultair.exe`:

| Check | Expected | Last verified |
|---|---|---|
| Window opens frameless (no title bar); header controls min/max/close work; header and sidebar brand row drag the window | Yes | 2026-09-23: frameless window and header controls render (screenshot). Dragging and double-click-to-maximize _need a manual check_ |
| Second launch | Focuses the existing window; still one process | 2026-09-23 |
| Log file created | `%LOCALAPPDATA%\Vaultair\logs\vaultair.<date>.log` with a "started" line | 2026-09-23 |
| F5, Ctrl+P, Ctrl+F, Ctrl+Shift+I, right-click | Nothing happens | _needs a manual check_ |
| CSP blocks inline script | Temporarily add `<script>document.title='pwned'</script>` to `index.html`, build, run: the title stays "Vaultair" | _needs a manual check_ |
