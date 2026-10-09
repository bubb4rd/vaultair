# ADR-0007: Browser extension for fill and save

- **Status:** Proposed. Nothing here is built. Work starts only when every box in [`future-extension-sync-checklist.md`](../future-extension-sync-checklist.md) ("For all of them" and "Browser extension and autofill") is ticked. A security review on 2026-10-09 found 22 issues; the design below resolves all of them ([Security review](#security-review-2026-10-09)).
- **Date:** 2026-10-08
- **Supersedes, once accepted:** the line in ADR-0004 "Also recorded" that reads "No auto-fill or auto-login, ever." Auto-login stays out, as do the spec's non-goals: nothing is ever submitted, and nothing is filled without a user action.
- **Decided by:** project owner (scope: fill and save, security beyond the minimum)

## Context

Today, getting a login from Vaultair into a browser is copy and paste. Getting a new or changed password from a browser into Vaultair is the same in reverse. Both are slow, and the second is where people give up and reuse passwords.

Vaultair has no server and no API. The only way into the Rust side is the webview's own IPC (`src-tauri/capabilities/main.json`). An extension therefore needs a new local channel, which ends two facts the MVP relies on: "nothing listens" and "no other program can ask Vaultair for anything". The "no network" promise can survive, and this design keeps it.

The two features move data in opposite directions, and their risks differ:

| | Fill | Save |
|---|---|---|
| Data moves | Vaultair → web page | Web page → Vaultair |
| Worst case if the channel is impersonated | The extension is given the wrong credentials | A freshly typed password is handed to an impostor |
| What stops it | Origin matching in Rust; user gesture | Mutual authentication of the app and the extension; confirm in Vaultair's window |

Save is the reason the channel needs mutual authentication, not only a check by the app.

## Options considered

| Option | Verdict |
|---|---|
| Webhook to a remote server or relay | **Rejected.** Needs a server, so data leaves the PC. Breaks local-first and checklist box 4. |
| Local HTTP or WebSocket listener ("local webhook") | **Rejected.** Every web page and every local process can reach `127.0.0.1`. DNS rebinding and CSRF are standing risks. Needs `hyper` or `tungstenite`, both banned in `deny.toml`. |
| Custom URL scheme (`vaultair://`) | **Rejected.** Browser to app only, so it can't return a fill, and any page can trigger it. |
| Extension holds its own encrypted copy of the vault | **Rejected.** Puts the DEK in the extension and gives it bulk access. Fails checklist box 3 and the "no bulk access" box. |
| Auto-type into the focused window (`SendInput`) | **Not part of this ADR.** Not bound to a site, so it can type into the wrong window. Close to the "automated or scripted logins" non-goal. |
| **Native Messaging + a local named pipe** | **Chosen.** The browser starts a registered host and allows only our extension ID. No port, no network code. This is the pattern used by 1Password, Bitwarden desktop integration and KeePassXC. |

## Decision

### 1. Scope

In scope:
- **Fill:** username and password into the login form on the current page, after a user gesture.
- **Save:** a new login, or a changed password, read from the current page's form after a user gesture, and written to the vault only after the user confirms in Vaultair's own window.
- **Authenticator codes:** the current TOTP code, filled after its own gesture. Off by default; the rules and reasoning are in §7.

Out of scope:
- auto-submit, fill on page load, and auto-login of any kind;
- inline field icons or menus, which would need `<all_urls>`;
- game launchers, passkeys (Phase 17 in `docs/roadmap.md`), sync, and any bulk export or search through the extension.

### 2. Components

```
Extension (MV3, Chrome/Edge/Firefox)
   ├─ JS: popup, page injection, Native Messaging      no crypto, no message parsing
   └─ vaultair-bridge-wasm (snow + protocol, WASM)     handshake, encryption, messages
   │  Native Messaging: stdin/stdout, length-prefixed frames
vaultair-browser-host.exe        relays opaque bytes, holds no keys
   │  \\.\pipe\vaultair-browser-<user SID>
Vaultair app (Rust)              same protocol crate, plus matcher and vault access
```

- **Noise implementation: `snow`, on both ends.** The app links it natively. The extension runs the same Rust code compiled to `wasm32-unknown-unknown` with `wasm-bindgen`. Why this one:
  - One implementation means no interoperability gaps between two libraries' readings of the spec.
  - The suite and patterns above (KK, XX, BLAKE2s, handshake hash for the pairing code) need no change.
  - JavaScript holds no cryptographic code and parses no protocol messages.

  The alternatives considered were holepunch `noise-handshake` (no KK, BLAKE2b only), emilbayes `noise-protocol` (beta, KK untested, handshake hash not exposed), our own state machine on `@noble/*`, `@chainsafe/libp2p-noise`, `noise-c.wasm`, `signalis-noise` and `noise-ts`.
- **`crates/vaultair-bridge-proto`** (new, pure Rust, `#![forbid(unsafe_code)]`, no I/O, no SQLCipher). It is shared by the app and the extension, and holds:
  - the message enum (`deny_unknown_fields`, size caps), the session header, the frame codec and the Noise session wrapper over `snow`;
  - the pairing commitment and short-code derivation (§5), and the request code (§6).

  `snow` is pinned to one version and built with `default-features = false` and only the features this suite needs: `use-curve25519`, `use-chacha20poly1305`, `use-blake2`, and `use-getrandom`, which gives the default resolver its random numbers. Secrets are held in `zeroize` types. That covers Rust memory; in the extension, it means WASM linear memory only.
- **`crates/vaultair-bridge-wasm`** (new) is a thin `wasm-bindgen` wrapper over `vaultair-bridge-proto` for the extension.
  - It exposes a handful of functions: start pairing, confirm pairing, open a session, encrypt a request, decrypt a reply, make a grant key, and show the app key's fingerprint.
  - Session keys stay in WASM memory and are zeroized when the session ends. Three things pass through JavaScript, where nothing can be zeroized: the long-term private key, read from `storage.local` and passed in when a session opens; the grant private key, handed out to be kept in `storage.session`; and decrypted replies (`{ username, password }`, codes), which JavaScript writes into the page. They fall under the threat model's best-effort memory limit.
  - Random numbers come from `crypto.getRandomValues`, through `getrandom` 0.3's `wasm_js` backend, which the build selects explicitly. CI fails if the wasm dependency graph has a `getrandom` without a browser backend or with the `custom` backend. A fixed RNG for known-answer tests exists only under `cfg(test)`.
- **`vaultair-core::bridge`** (pure Rust, `#![forbid(unsafe_code)]`) uses `vaultair-bridge-proto` and adds what needs the vault:
  - the bridge file and its pairing records (§10), the origin matcher and the curated host lists (§9), the per-session table of opaque handles;
  - the pending-save slot and the limits (§6).
- **`vaultair-platform::windows`** gains the pipe server (its security descriptor, the first-instance rule, one instance always listening), the peer-process and signature checks (H1), and the Windows Hello consent check (H2) beside the existing Hello code. This is the only new `unsafe`, kept in the crate that already holds it.
- **`crates/vaultair-browser-host`** is a small new binary:
  - Framing in, framing out, size caps. It exits when stdin closes.
  - It never parses message contents. Every frame after `hello` is ciphertext to it. When it can't reach the pipe, it answers `unavailable` itself (§6).
  - **It checks what it connected to, from the first release.** It opens the pipe with `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION` (tokio's default, set explicitly), so the server can't act with the user's Windows token. Then it checks that the pipe's owner SID and the server process's user (`GetNamedPipeServerProcessId`, then that process's token) are its own user, and refuses otherwise. That keeps out a pipe created by another Windows user. A squatter running as the same user passes this check and is stopped by the pinned keys (M4). Signature checks follow once releases are signed (H1).
  - It checks that the origin argument the browser passes (`chrome-extension://<id>/` from Chrome and Edge, the add-on id from Firefox) is one of ours. That is a hint, not authentication: any program that starts the helper can pass the same argument.
- **`extension/`** is a new folder in this repository: one MV3 codebase for all three browsers, with its source published here.
  - Permissions: `nativeMessaging`, `activeTab`, `scripting`, `storage`. Nothing else, and in particular no host permissions.
  - `storage` is used for two things only: the long-term pairing record in `storage.local`, and the per-unlock grant key in `storage.session` (§10). `storage.session` is limited to trusted contexts by default in every supported browser. `storage.local` is limited with `setAccessLevel` in Chrome and Edge, which support it for that area from version 140. Firefox has no `setAccessLevel`, so there the extension's own injected probe and fill functions could read `storage.local`, and so could a compromised renderer for a page they ran in. A lint rule keeps the storage API out of injected functions. `storage.sync` and IndexedDB are never used. No fill, code, password or account data is ever written to any storage area.
  - Inherits the app's ESLint bans (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, web storage for secrets), and adds `indexedDB`. The extension needs no network.
  - Its CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'none'`: the MV3 default, the one token that loading the bundled `vaultair-bridge-wasm` needs, and a ban on network connections. No remote code, no `'unsafe-eval'`. Having no host permissions doesn't stop an extension sending data out, because a `no-cors` request needs none, so `connect-src 'none'` is what keeps this code from doing it. An update can change the CSP, so this covers the published code, not a malicious update (threat model).
  - Minimum browser versions, set in the manifest: `minimum_chrome_version` `"140"` (Chrome and Edge), the first with `setAccessLevel` for `storage.local`; and `browser_specific_settings.gecko.strict_min_version` `"153.0"` (Firefox), the first where `scripting.executeScript` accepts `documentIds` and returns `documentId` (bug 1891478, Firefox 153, 2026-07-21, now an ESR). Both versions also support the `checkVisibility` options H4 uses. Firefox ESR 140, which Mozilla still supports, can't install the extension; there is no weaker code path for it (§7).
  - Development builds use their own manifest `key`, so a development copy never takes the store build's ID or its storage.
- **Host registration.**
  - The installer puts the helper binary next to `vaultair.exe` and registers nothing.
  - Turning the bridge on makes Vaultair write the host manifest and the `HKCU\Software\{Google\Chrome,Microsoft\Edge,Mozilla}\NativeMessagingHosts\<name>` keys. Edge gets its own key rather than relying on its fallback to Chrome's. Turning it off for the last vault that had it on removes them. These are per-user keys, so no administrator rights are needed. This is what keeps M11 true: with the bridge off, no browser can start the helper.
  - The switch is per vault (Settings → Browser, kept in `vault_settings`). The registration and the pipe are per Windows account: Vaultair keeps the registration, and listens while it runs, as long as at least one vault on this PC has the bridge on, and records which ones in `config.json` so it knows while every vault is locked. Once a vault is unlocked, its own switch decides: while a vault whose switch is off is open, including after H7 turned it off, the app refuses every session header with `unknown_pairing` (§6), whatever its bridge file holds. Turning the switch off keeps the vault's pairings, and turning it back on, which takes the master password, resumes them; Revoke is what ends a pairing. Editing the `config.json` record can only stop the bridge or open a pipe that refuses everything.
  - The manifest lists only our extension: `allowed_origins` with both the Chrome Web Store ID and the Edge Add-ons ID (Edge can also install from the Chrome Web Store), and `allowed_extensions` with the Firefox ID. This stops other store-installed extensions from starting the helper. It doesn't authenticate the extension: an unpacked extension carrying our key, or a Firefox add-on declaring our id, can claim the ID. Pairing (M3, M4) is what authenticates it.
  - An administrator can turn off per-user hosts (the `NativeMessagingUserLevelHosts` policy in Chrome and Edge), and the browser then ignores these keys. Settings → Browser reads that policy and says the bridge is blocked by policy for that browser. Registering for all users (HKLM) needs administrator rights and is not part of this ADR.
  - The uninstaller also removes the keys and the manifest, in case the bridge was left on.

### 3. Security: the required minimum (ship-blocking)

Fill and save do not ship without all of these.

| # | Measure | Protects against |
|---|---|---|
| M1 | Pipe DACL grants only the current user's SID. `PIPE_REJECT_REMOTE_CLIENTS`. `FILE_FLAG_FIRST_PIPE_INSTANCE`: if the name already exists when Vaultair creates the pipe, Vaultair refuses to start the bridge and says the pipe was taken. One instance is always listening while the app runs, so the name is never free while Vaultair is up. The helper checks that the pipe belongs to its own user (§2) | Other Windows users connecting to the pipe or taking its name; remote clients. A squatter running as the same user is stopped by M4 and, once releases are signed, H1 |
| M2 | Host manifest lists only our extension IDs (§2) | Store-installed extensions other than ours starting the helper. Not authentication: pairing (M3, M4) is |
| M3 | Pairing with a short authentication string and a commitment (§5), confirmed in both UIs before either side pins a key. Each attempt is single-use and needs the master password | An impostor inserting itself at first contact |
| M4 | Every session is Noise_KK with both static keys pinned at pairing, empty handshake payloads, and every request sent as a transport message after the handshake (§6) | Impersonation of either side; reading or altering traffic through the host or the pipe; replay |
| M5 | Origin matched in Rust by the written rules in §9. A mismatch is a refusal | A page receiving another site's credentials |
| M6 | Fill only after a user gesture, top frame only, never submitted (§7) | Fill on load; iframe and clickjacking attacks |
| M7 | Save only after a confirm in Vaultair's own window, which shows site, username, and new account or update (§8) | Forged or unwanted writes to the vault |
| M8 | No bulk access. One origin per `match`, one `match` per session, opaque handles that die on lock, and the limits in §6 (6 sessions a minute, 30 sites per unlock, per pairing). Every lookup is recorded in the activity list | A compromised extension or a copied key mapping or draining the vault |
| M9 | Locked vault: the app answers `locked` and nothing else. No handshake runs while locked. Unlocked, `hello` says only `unlocked`, with no key hint or vault id | Probing whether an account exists; telling vaults apart |
| M10 | Nothing secret is logged, cached or persisted by the host or the extension. The only exception is the extension's own pairing key and grant key (§10), which open nothing in the vault by themselves. The canary tests cover the pipe and the host | Leaks to disk |
| M11 | Off by default. With the switch off there is no pipe, no host registration and no new files beyond the helper binary the installer always puts next to `vaultair.exe`, and a test proves it | Users who never turn it on paying for it |

**Fallback considered and rejected for the minimum:** a sealed box (`crypto_box_seal` to the app's pinned key) for saves only. It keeps the password confidential but does not authenticate the sender or protect fills, so M4 stays the minimum.

### 4. Security: planned beyond the minimum

These are part of the plan, not optional extras.

**Before the first public release:**

| # | Measure | Protects against |
|---|---|---|
| H1 | Signed releases (ADR-0004 decision 14), then signature checks both ways, on top of §2's user checks. The host checks the pipe server's image path and Authenticode signer; the app checks the client's (`GetNamedPipeClientProcessId`) | Unsigned programs posing as Vaultair. The app's check on its client proves little, because any program can run the signed helper; pairing authenticates the extension |
| H2 | Windows Hello consent check (`UserConsentVerifier`) before a save, and optionally before code fills or every fill (§11). Uses no Hello key. Offered on Windows 11 with Hello set up | A copied extension key, or a click someone else makes in Vaultair's window |
| H3 | The Noise prologue binds the session header (protocol version, pairing ID, key kind), the vault ID and the browser kind. The app refuses versions below a minimum | Cross-vault confusion; a changed session header; downgrade to an older, weaker protocol |
| H4 | Fill writes only to enabled `input` elements of the right type, in the form the user acted on, that pass the visibility test in §7 (opacity, size, viewport, hit test). The password goes only into `type=password`. Probe and fill run in the isolated world | Filling fields the user cannot see, such as one under an overlay. It doesn't stop the matched site reading a field, which it can always do |
| H5 | The fill is pinned to the exact document that was checked, using `documentId` in every supported browser, and the injected function re-checks `location.origin` before writing (§7, "Pinning the page") | Navigation or reload between match and fill (time-of-check/time-of-use) |
| H6 | `http:` pages are never filled unless the stored URL is itself `http:`, and then only with a visible warning | Downgrade and network interception |
| H7 | Failed attempts turn the bridge off until the user turns it on again, and Vaultair says why: 3 interrupted pairing attempts, or 5 failed handshakes, denied or timed-out prompts, requests turned away while a prompt was open, and cancelled Hello approvals, within one unlock. Refusals of unknown or revoked pairings don't count | Online guessing of a pairing; noisy attacks. Anything that can reach the pipe can use this to turn the bridge off (denial of service) |
| H8 | Settings → Browser lists each pairing with its browser, created date, last used date, fill and save counts and the app key's fingerprint, plus the recent activity list (§11). Revoke ends the pairing and everything it holds (§10) | Silent long-term misuse |
| H9 | Extension supply chain: pinned dependencies, minimal dependencies, no remote code (MV3 enforces it), reproducible builds checked in CI, 2FA on every store publisher account | A malicious update reaching users by a route other than the app's |
| H10 | Browser approval setting, default "Once per unlock", with a request code shown in both the prompt and the browser (§6, §11) | A copied long-term key being used silently, including a request timed to arrive with the user's own click |
| H11 | Fill and save notices, on by default (§11) | Misuse going unnoticed |

**Later (tracked, not blocking):**
- Optional re-pairing after an app update that changes the host's signer.
- Reconsider fill and save per vault versus per app if multiple vaults become common.

### 5. Pairing

1. The user turns on the bridge in Settings → Browser and clicks Pair. The app asks for the master password, as other sensitive actions do (ADR-0005 decision 4). That password authorises **one** pairing attempt.
2. In the browser, the user clicks Pair in the extension popup, which opens the extension's own pairing tab. Pairing runs in that tab, not in the popup, because the popup closes as soon as another window takes focus. The two sides run Noise_XX, which exchanges static keys under encryption.
3. **Commitment, then the short code.** A 6-digit code alone is too short: someone in the middle could grind ephemeral keys until both legs show the same code. Pairing therefore follows the Bluetooth numeric-comparison pattern:
   1. The extension sends `H(Ne)`, a commitment to a random 32-byte nonce.
   2. The app replies with `Na`.
   3. The extension reveals `Ne`.
   4. Code = 6 decimal digits taken from `HKDF(handshake_hash ‖ Ne ‖ Na)`.

   An attacker in the middle has to commit before seeing the other side's nonce, so each attempt gives it one guess, at 1 in 10⁶. Step 5 makes sure it gets one attempt per master password.
4. **Both screens show the code, and both confirms are needed.** Vaultair's pairing dialog and the extension's pairing tab show the same code. The user clicks Confirm in Vaultair and "Codes match" in the extension tab, in either order. Each side sends its confirm to the other inside the XX session, and each pins the other's static key only after both its own user's click and the other side's confirm. An attacker in the middle can forge the other side's message, but not the click on this side, so neither side pins on its peer's word alone.
5. **Each attempt is single-use.** Anything other than both confirms ends the attempt: a Reject on either side, a disconnect, a commitment that doesn't match its reveal, a timeout, a lock, or closing the dialog or the tab. The app wipes the handshake state and both nonces, the code disappears from both screens, and Vaultair shows "Pairing was interrupted". A new attempt needs the master password again, and an interrupted attempt counts toward H7. The extension never restarts pairing by itself.
   - **An unconfirmed attempt expires after 5 minutes.** The 5 minutes count from when the master password is accepted in step 1, on the monotonic clock. One attempt exists at a time.
   - **A confirmed pairing lasts until it is revoked** (H8), or until the master password or the KDF changes, which ends every pairing for that vault on this PC (§10). It has no expiry of its own.
6. A pairing belongs to one vault, one browser profile and this PC. Pairing two browsers or two vaults means pairing twice.

### 6. Session

- **Before the handshake.** If the helper can't reach the pipe (Vaultair isn't running, or the bridge is off), the helper itself answers `{ state: "unavailable" }`. Otherwise the extension sends `hello`, and the app answers `{ state: "locked" }` or `{ state: "unlocked" }`, with no key hint and no vault id. `request_unlock`, also sent before the handshake, brings Vaultair's window to the front; the app honours it at most once every 10 seconds and ignores it while Vaultair already has focus. Nothing else is answered without a session. Any program running as the user can learn this way whether the vault is unlocked, as it could from Vaultair's window; the threat model says so.
- **Session header.** Every session opens with a fixed cleartext header `{ protocol_version, pairing_id, key_kind }`, at most 64 bytes, where `key_kind` is `long_term` or `grant`. The app uses it to pick the extension's static key, from the bridge file (§10) for `long_term` or from memory for `grant`, without trying keys in turn. The header goes byte for byte into the Noise prologue, with the vault id the app expects and the browser kind (H3), so a changed header fails the handshake.
- **Refusals before the handshake.** The app may refuse a header with `{ refused: "revoked" | "unknown_pairing" | "no_grant" }`: `revoked` for a revoked pairing; `unknown_pairing` when the open vault has no such pairing or its bridge switch is off; `no_grant` for a grant the app no longer holds (after a lock, a limit, a replacement, a stricter setting or a revoke). None of these counts toward H7. On `no_grant`, the extension deletes its grant key and opens a long-term-key session in the same gesture. On `unknown_pairing`, it says that the vault open in Vaultair isn't paired with this browser or has its bridge off. Only `revoked` offers to pair again (§10). These replies aren't authenticated, so the extension never deletes its long-term key because of one.
- **The handshake** is Noise_KK (`Noise_KK_25519_ChaChaPoly_BLAKE2s`, `snow` on both ends), with that prologue. **Both handshake messages carry empty payloads,** and the app refuses a non-empty first message: in KK, a payload in the first message can be replayed and has no forward secrecy. Every request travels as a transport message after the handshake, so each session's fresh ephemeral keys give it forward secrecy, and Noise's nonce counter stops replay. A session and its first request take two round trips over a local pipe, which the user doesn't notice.
- **One session per gesture.** Each click or shortcut opens a new session and closes it when the fill, code fill or save is done. Chrome stops an idle extension service worker after a short time, which wipes its memory, so no session state is kept between gestures.
- **Which static key the extension uses** depends on the browser approval setting (§11). Under "Never", it is the long-term pairing key. Under "Once per unlock", it is the grant key for this unlock once one has been approved, and the long-term key only to ask for that approval. Under "Always", it is the long-term key, with an approval for every session.
- **Approval inside a session.** When the approval setting asks for an Allow (§11), the app answers the session's first request with `approval_pending` and shows its prompt. Both sides take a 4-digit **request code** from `HKDF(handshake_hash, "vaultair/v1/approval-code")`. The extension shows it in its popup and as its toolbar badge, Vaultair's prompt shows it, and the user Allows only if the two match. Vaultair's prompt opens without taking focus, so the popup can stay open beside it; the popup may still close, so the badge keeps the code visible and the session's state lives in the background script, not the popup. The real reply follows the Allow; a Deny or the 2-minute timeout ends the session.
- **Messages inside a session.** Each one has a fixed schema with size caps. Unknown fields or types end the session.

  | Message | Reply |
  |---|---|
  | `match { origin }` | `[{ handle, title, username, hint }]` for that origin only, where `hint` tells masked entries apart (§7). At most one `match` per session |
  | `fill { handle }` | `{ username, password }` |
  | `totp { handle, method_id? }` | `{ code, seconds_remaining }`; only when authenticator-code fill is on (§7) |
  | `save_begin { origin, username, password, confirm_field_matched }` | `{ pending_id }`, or `busy` while another save waits for its confirm (§8) |
  | `save_status { pending_id }` | `confirmed`, `rejected` or `expired` |
  | `grant { public_key }` | `ok`; only in an approved long-term-key session under "Once per unlock" (§11) |
  | `bye` | none |

  Any request can also get `approval_pending` (above), `busy` (another approval prompt is open, §11) or `limited` (below).
- **Limits (M8).** Enforced in Rust, per pairing:
  - one `match` per session; a second one ends the session;
  - at most 6 sessions a minute; more get `limited`;
  - at most 30 distinct origins looked up per unlock. Reaching the cap ends that pairing's grant and is recorded in the activity list, with a notice when notices are on. Under "Always" and "Once per unlock", the next request prompts again, and the prompt says how many sites this browser has looked up; an Allow starts a new count. Under "Never", that pairing is refused until the next unlock;
  - one authenticator code per account per TOTP period, whichever handle asks.

  Every `match` is recorded in the activity list as a lookup (§11), so lookups leave a trace as fills and saves do.
- **On lock**, the app ends every session and clears the handle table, every grant and any pending save. The extension sees the pipe close.
- **Auto-lock.** Fills, authenticator-code fills and saves do not count as activity. They never call `SessionManager::touch`, so only activity in Vaultair's own window moves the idle deadline, and a browser cannot keep the vault open. With the 5-minute default, the vault will often be locked when the user reaches a login page. The popup then offers `request_unlock`.

### 7. Fill rules

- Triggered only by the toolbar button, the keyboard command or the popup. With `activeTab`, the extension can only touch a page after one of these.
- The origin sent to the app is confirmed by the browser, not taken from page content alone (see "Pinning the page" below). Only the top frame is used; `activeTab` does not reach cross-origin iframes.
- More than one match: the popup lists title and username and the user picks one. Exactly one: the popup still shows it before filling. The fill never happens without a choice the user can see.
- **The popup can't be hidden from screen capture,** because it is browser UI. So in every screenshot-protection mode except Off ("Always on", the default, and Custom), and whenever "Hide emails" is on, Rust masks usernames and emails in the `match` reply before sending it, with `redact_username` / `redact_email` (for example `N****l`). The unmasked value never reaches the extension. Titles are shown as they are. Masks can collide, so each entry also carries a `hint`: when the account was last used ("used 3 days ago", "never used"). These settings live in `config.json`, like the rest of the capture policy; masking protects against people watching the screen, not against a program that can edit files.
- **A fill puts the username in the page,** where screen capture can see it like anything else in the browser. Masking covers the popup only.
- H4 and H5 apply. Nothing is submitted.
- The password exists in the extension only in a local variable in the background script, for the length of the injection call. It is never written to `storage` or IndexedDB, and never sent to the popup.

**Pinning the page (H5).** Every gesture runs these steps, for fill, code fill and save alike:

1. **Probe.** `scripting.executeScript` with `target: { tabId, frameIds: [0] }` runs a probe in the top frame. It returns `location.origin` and a description of the form fields; it reads values only for a save. The browser's `InjectionResult` carries that document's `documentId`.
2. **Agree on the origin.** The background script reads `tabs.get(tabId).url`, which `activeTab` allows. Its origin must equal the probe's `location.origin`; if not, the gesture is refused and the popup says the page changed. Only the agreed origin goes to the app.
3. **Pinned fill.** The fill runs with `target: { tabId, documentIds: [documentId] }`. If that document is gone (a navigation, a reload, a closed tab), the browser refuses the injection and nothing is written. A `documentId` survives only same-document changes (`history.pushState`, fragment changes, a back/forward-cache restore), and none of these can change the origin.
4. **Last check.** Inside the pinned document, the fill function confirms that `location.origin` still equals the agreed origin and that the probed fields are still present, enabled and visible by H4's test. Otherwise it writes nothing.

**Visible, for H4,** means all of these for the field: `checkVisibility({ opacityProperty: true, visibilityProperty: true })` is true; its rendered box is at least 10 × 10 CSS pixels and its centre lies inside the viewport; and `document.elementFromPoint` at that centre returns the field itself. The last test refuses a field under an overlay, including a cross-origin frame laid over it. The probe and fill functions always run in the extension's isolated world, never `world: "MAIN"`, so page scripts can't hook the code that writes the value.

A failed check at any step is a refusal with a short reason in the popup, never a retry against whatever page is now loaded. The user clicks again on the new page, and a new probe starts.

**Authenticator codes (TOTP).** In scope, behind a per-vault setting "Fill authenticator codes" in Settings → Browser that is off by default. Turning it on needs the master password and says what changes.

Why it is in scope:
- **It doesn't create a new store.** Vaultair already stores TOTP setup keys next to passwords (ADR-0004 decision 2), so the two factors already sit together at rest. Filling adds a per-origin way out, nothing more.
- **It's safer than copy and paste against phishing.** A copied code can be pasted into any page, including a live phishing proxy that relays it. A filled code goes only to an origin that passes §9.

Why it is off by default: with it on, one paired extension plus one gesture gives the password and the current code for an origin, which is a full login. A stolen extension key plus control of the browser gets both.

Rules:
- `totp` takes a handle from a `match` in the same session, so the code is bound to the same origin check as the password. If the account has more than one TOTP method, the popup lists their labels and the user picks.
- Only the current code and its seconds remaining leave the app, computed in Rust as `mfa::totp_code` does today. The setup key never leaves.
- If fewer than 5 seconds remain in the period, the app waits for the next code before answering, so the user doesn't get a code that is about to expire.
- It needs its own gesture: a separate popup button or keyboard command, never chained automatically after a password fill.
- It is filled into one input that passes H4: the one the user focused, or the only one with `autocomplete="one-time-code"`. H5 applies, and nothing is submitted.
- At most one code per account per TOTP period, whichever handle or session asks (§6, "Limits").
- H2 offers Windows Hello approval for code fills.
- Backup codes are never filled. They stay copy-only in Vaultair.

### 8. Save rules

- Triggered by "Save to Vaultair" in the popup. The injected script reads the form the user is on: the focused form, or the only one with a password field. No content script watches submissions.
- **Which fields.** The username is the field with `autocomplete="username"`, or else the text or email input before the first password field. The password is chosen in this order, and anything else is refused with "Vaultair can't tell which password is the new one":
  1. one password field: that one;
  2. fields marked `autocomplete="new-password"`: the new one, and when there are two, they must be equal (new and confirm). Fields marked `current-password` are ignored;
  3. no such marks and two or three password fields: the last two must be equal, and that value is saved.

  `confirm_field_matched` in `save_begin` says whether a confirm field matched.
- The probe and origin agreement from "Pinning the page" (§7) run first. The origin in `save_begin` is the agreed origin, never one the page reports by itself alone.
- The password goes to the app inside the Noise session and is held in Rust in zeroizing memory, as the pending save. **There is one pending save per vault.** While its confirm is open, any other `save_begin`, from any pairing, gets `busy`; it never replaces the value. The extension then says that Vaultair is already confirming another save and that, if the user didn't start it, they should choose Reject there. The pending save expires after 2 minutes and is dropped on lock.
- Vaultair's own window, under the current screenshot-protection policy, shows:
  - the site host, the username, and "New account" or "Update <account title>";
  - the session's request code (§6), in every approval setting, which the extension also shows for the user's own save, so a save sent by something else shows a code the browser doesn't;
  - the password's length, and "Matches the confirm field" when the extension reported one, so a value the user didn't type is likely to look wrong;
  - never the password, behind a Show button or otherwise.

  Confirm needs a click there, plus Windows Hello under H2.
- **Update.** The previous password is kept, not overwritten. It moves to a hidden custom field "Previous password (<date>)" so a bad or mistaken save can be undone. `password_changed_at` is set.
- **New account.** `login_url` is set from the origin through `validation::web_url`, the account type is `website`, and the default purpose is used. The user can edit everything afterwards.
- The vault's single writer stays the open app process, so the single-writer box in the checklist holds as it is.

### 9. Origin matching

- **Which stored addresses count.** An account matches when the origin matches any of:
  - its `login_url`, or, when it has none, its platform's `default_login_url`. This is the address "Open login page" already uses (`db/repo/account.rs`);
  - its `website_url`, **only when** the account's "Also fill on its website address" is on. That is a per-account setting in the account form, off by default. `website_url` is an information-only field today (a profile, a wiki, a store page), so it releases nothing unless the user says so.

  A platform's `default_login_url` can be edited, including on a built-in platform, and the edit then decides where every account of that platform without its own `login_url` is filled. The platform form says so.
- Scheme must match (see H6), and so must the port, after the default ports are made explicit (443 for `https`, 80 for `http`).
- Hosts are compared as lowercase ASCII. Browsers report IDN hosts as punycode, and `validation::url_host` accepts only ASCII, so a homograph lookalike does not equal a stored host.
- Matching uses the origin only, never the path. On a host that keeps tenants apart by path, every tenant matches; the website-address opt-in keeps the addresses where that is most likely out by default.
- The default is an exact host match. Two widenings are planned:
  - **Per account:** "Match the whole domain". It matches any host under the same registrable domain, using the Public Suffix List with its private section, compiled in (the `psl` crate, no network), and never across registrable domains. It is refused for an IP literal and for a host whose suffix isn't in the list.
  - **Per built-in platform:** a curated host list (for example Steam's store, login and community hosts), kept in versioned app code (`vaultair-core::bridge::hosts`), not in the catalog tables, so an update can correct it. It applies only while the platform's `default_login_url` is still the built-in one.
- Table tests must refuse:
  - `steampowered.com.evil.example`, `evil-steampowered.com`, a trailing dot;
  - userinfo, an `xn--` lookalike;
  - `http` against an `https` record, a port change, and a suffix-only domain such as `co.uk`;
  - whole-domain matching on an IP literal or an unlisted suffix;
  - a `website_url` match while the account's opt-in is off, and a curated host after the user edited the platform's login address.

  They must accept `https://host:443` against `https://host`.

### 10. Keys, storage and revocation

| Key | Where it lives | Available when |
|---|---|---|
| App static X25519 key, one per vault on each PC | The bridge file, `%LOCALAPPDATA%\Vaultair\devices\<vault_id>.bridge` (below): outside the vault folder, never in a backup | Only while that vault is unlocked on this PC |
| Pairing records: pinned extension public keys, browser, dates, counts, and the ids of revoked pairings | The same file, under the same seal | Only while unlocked |
| Extension long-term pairing key, the pinned app public key and the pairing id | `storage.local`, limited to trusted contexts where the browser allows it (§2). Survives clearing cache and history; removed on uninstall | While the browser profile is readable |
| Extension grant key (§11, "Once per unlock" only) | `storage.session`: kept in memory and not persisted by the browser; cleared when the browser stops. Chrome and Edge also clear it when the extension is reloaded or updated; Firefox documents clearing it on disable and uninstall, and says nothing about updates | From approval until Vaultair locks or the browser restarts |
| Pinned grant public key, with its pairing id | App memory only | Until the vault locks, the pairing is revoked, or the approval setting is made stricter |

**The bridge file** follows the Windows Hello slot's pattern (`vault-format.md` §12), which the checklist asks of access that stays on one device:
- On disk it is the output of DPAPI `CryptProtectData` (current user, entropy = the vault id) over `"VAULTAIRBR" | file_version u16 LE | body_len u32 LE | JSON body | CRC32 u32 LE`.
- The body holds `vault_id`, `binding_b64` (the same header binding as the Hello slot) and `sealed`: XChaCha20-Poly1305 under `BRIDGE_KEY`, a new key derived from the DEK (`vault-format.md` §5), with AAD `"vaultair-bridge-file-aad-v1\0" || vault_id || 0x00 || binding`, over the app's static private key and the pairing records.
- Because `BRIDGE_KEY` comes from the DEK, the file can only be read or written while the vault is unlocked. A program that can edit files can't forge or change a pinned key without breaking the seal. It could put back an older copy of the file, for example one from before a Revoke, so the file also carries a generation counter under the seal, and the vault keeps the same counter in `vault_settings`; both go up on every pair and revoke. A file whose counter differs from the vault's is deleted, which ends every pairing. Short of that, deleting the file is the most such a program can do.
- **A password or KDF change ends every pairing** for that vault on this PC. Vaultair deletes the file as it does the Hello slot, and a file whose binding no longer matches the header is deleted when it is next read. Settings → Browser then says that browsers need pairing again after a password change, and offers Pair.
- **Backups.** The file is not in a backup, so an old backup and an old master password give nothing that speaks for Vaultair today. A restored copy with the same header (same master password and KDF) and the same generation counter uses the same pairings on this PC, as the Hello slot does: it is the same vault on the same PC. A copy from before the last pair or revoke has a different counter, so its pairings end. On another PC there is no bridge file, and the user pairs there.
- No header key slot. The extension never holds the DEK or any key that opens the vault, so `vault-format.md` stays v1.

**The activity list** is the one new table inside the vault (`browser_activity`, V9 migration, §11). It is vault data, so it is in backups like the rest.

**Revocation.** Revoke, in Settings → Browser:
- removes the pairing from the bridge file and adds its id to the revoked list there;
- drops that pairing's grant, ends its open sessions, invalidates its handles, and drops a pending save it made;
- writes an activity entry.

The extension finds out at its next session: the app refuses a header naming a revoked pairing with `revoked` before any handshake (§6), and doesn't count it toward H7. The extension then says that Vaultair no longer accepts this browser and offers to pair again. It keeps its key until a new pairing replaces it, because the refusal is not authenticated, and a forged one must not make it forget a working pairing. Revocation is complete for what the bridge holds: the extension never had vault data beyond the fills it was given, so there is no stored copy to recall.

**Losing the extension's keys** (uninstall, a reset of the browser profile, or a corrupted `storage.local`, which Firefox resets automatically) loses no vault data. The user pairs again.

**Which Vaultair the extension trusts.** A program running as the user can rewrite the extension's `storage.local`, for example while the browser is closed, and pin its own key as Vaultair's, then point the registration at its own helper. That is within the existing "malware running as you" exclusion. Two signs show it: a save that doesn't bring up Vaultair's own confirm window, and the app-key fingerprint on the extension's options page differing from the one in Settings → Browser. Both screens show the fingerprint as 8 groups of 4 hex digits.

### 11. Browser approval and notices

**Browser approval.** A copied long-term pairing key, by itself, would let a program run as the user and ask for fills for sites it names, without the click the extension requires. The browser approval setting decides how much a Vaultair approval is needed on top of the key. It is a per-vault setting in Settings → Browser, stored inside the vault (in `vault_settings`, not `config.json`), so a program that can edit files cannot weaken it.

| Setting | What needs an Allow in Vaultair's own window | A copied long-term key alone gets |
|---|---|---|
| **Always** | Every session: each fill, code fill and save request | Nothing without a visible prompt whose request code matches what the user's browser shows |
| **Once per unlock** (default) | The first session from each paired browser after each unlock, and any later long-term-key session from that browser | The same: nothing without a prompt whose code the user checks |
| **Never** | Nothing beyond the pairing | Lookups, fills and code fills for any site it names, while the vault is unlocked, up to the limits in §6. Saves still need M7's confirm |

- **The prompt** shows the request code (§6), the browser the client says it is, and the real scope of an Allow:
  - under "Always": "Chrome wants to fill a login on store.steampowered.com. Code 4821";
  - under "Once per unlock": "Allow Chrome to fill logins on any site until Vaultair locks? First request: store.steampowered.com. Code 4821".

  It tells the user to Allow only if the browser shows the same code. It offers Allow and Deny, and it times out as a Deny after 2 minutes. Under "Always", a save's own confirm (M7) counts as the approval for that session, so the user is not asked twice; the save confirm shows the request code in every setting (§8). When H2 asks for Windows Hello on the same request, Hello follows the Allow.
- **One prompt at a time.** While a prompt is open, every other request that needs an Allow gets `busy`, and the prompt shows how many were turned away ("1 other request was refused while this was open"). The extension then says that Vaultair is already asking about another request and that, if the user didn't make it, they should choose Deny. A malicious request timed to arrive just before the user's click therefore shows the wrong code, and the user's own request is visibly refused.
- **"Once per unlock" mechanics.**
  1. After the user clicks Allow, `vaultair-bridge-wasm` creates a fresh X25519 grant key pair and sends its public half in that session (`grant`).
  2. The app pins the grant public key in memory, with the pairing id, until the vault locks, the pairing is revoked or the setting is made stricter.
  3. The extension keeps the grant private key in `storage.session` only.
  4. Later sessions in the same unlock use the grant key as the extension's static key in Noise_KK (`key_kind` `grant`) and need no prompt.

  A long-term-key session from a pairing that already holds a grant prompts again; an Allow replaces the old grant, and the activity list records it. A lock forgets the grant on the app side, and a browser restart forgets it on the extension side. Either way, the next session asks again.
- **Changing the settings.** The bridge's settings are ordered from strictest to loosest:
  - approval: Always, Once per unlock, Never;
  - Windows Hello approval (H2): every fill, saves and authenticator codes, saves only, off;
  - notices: on, off;
  - authenticator-code fill: off, on.

  Any change toward the loose end takes the master password, as other actions that lower protection do (ADR-0005 decision 4), and the screen says what the change allows. A change toward the strict end takes effect at once without it, and a stricter approval setting drops existing grants.
- **Failed attempts** count toward H7: denied and timed-out prompts, requests turned away while a prompt was open, and cancelled Windows Hello approvals. A save turned away by `busy` because another save waits for its confirm (§8) doesn't count.

**Windows Hello approval (H2).** Vaultair asks Windows for a Hello consent check (`UserConsentVerifier`, opened over Vaultair's own window through `IUserConsentVerifierInterop`), with a message such as "Vaultair: approve saving a login from Chrome".
- **It uses no key.** No Hello key is created or signed with, so ADR-0005's key keeps its one purpose, and an H2 prompt can never produce anything that unwraps the data key. An H2 cancel doesn't touch quick unlock's failure count.
- **Why a yes-or-no check is enough here.** ADR-0005 rejected `UserConsentVerifier` as the unlock gate because a patched app skips it. H2 guards an action inside the running app instead. Someone who can patch Vaultair is malware running as the user, already out of scope. What H2 adds is that a copied extension key, or a click someone else makes in Vaultair's window, is not enough: someone has to pass Windows Hello.
- **Setting:** saves only (the default), saves and authenticator codes, every fill, or off. It is offered on Windows 11, where `IUserConsentVerifierInterop` exists (build 22000 and later), when `CheckAvailabilityAsync` reports Hello as available. Otherwise Settings → Browser says that Windows Hello approval isn't available on this PC, so saves are confirmed with a click in Vaultair only, and saves work that way. Vaultair still supports Windows 10, where this is always the case.

**Fill and save notices.** A per-vault setting "Show fill and save notices", on by default. Turning it off takes the master password (above); turning it on doesn't.
- **What a notice shows.** Each fill, code fill and save shows a Windows notification with generic text only, for example "Vaultair filled a login in Chrome" or "Vaultair saved a login from Firefox." So does reaching a limit in §6. A notice never shows a site, account title, username or value. Windows keeps notification history in its own unencrypted database, and notifications can't be hidden from screen capture.
- **Where the details live.** The details (time, browser, kind, account, site host) go to the recent activity list in Settings → Browser. Its kinds are lookup, fill, code fill, save, grant, limit reached and revoke; a lookup records the site and how many accounts matched. The list is stored inside the vault and keeps the last 500 entries, whether notices are on or off. Repeated lookups and fills of the same site by the same pairing within one unlock are merged into one entry with a count, and grant, limit-reached and revoke entries are kept ahead of lookups and fills when the list is trimmed, so a burst of requests can't push them out.
- **When there's no notification.** If Windows suppresses notifications (Focus Assist, notifications off for Vaultair), the activity list is still written. With approval set to "Never", the notices and the activity list are the only signs of use, and the "Never" screen says so.

## Residual risks (to state in `threat-model.md`)

- **Malware running as the user** can read and rewrite the extension's `storage.local`, replace or re-register the helper, or drive the browser. Pairing does not change the existing "does NOT protect against" entry.
  - Under "Always" and "Once per unlock" (§11), a copied long-term key alone gets nothing without a prompt whose request code the user checks against the browser.
  - Under "Never", it can look up, fill and fill codes silently while the vault is unlocked, up to the limits in §6. Only the notices and the activity list show it.
  - Malware that reads the browser's memory can also take a live grant key.
  - By rewriting `storage.local` and the registration, it can make the extension treat it as Vaultair and receive later saves (§10, "Which Vaultair the extension trusts"). Vaultair's own confirm window doesn't appear for those saves.
  - H2, where it is available and left on (the default is saves only), means a save needs a Windows Hello approval. On Windows 10, without Hello, or with H2 turned off, a save needs a click in Vaultair's window.
- **A filled password is in the page's DOM.** Scripts on that same origin, including an XSS, can read it, as they could if the user typed it.
- **In Firefox, `storage.local` can't be limited to trusted contexts** (§2), so the extension's injected functions, or a compromised renderer for a page they ran in, could read the long-term pairing key.
- **`snow` has no formal audit**, as its README states. Every part of the channel rests on it, on both ends. Mitigations:
  - `snow`'s own cacophony test vectors and fuzzing;
  - our own known-answer tests in `vaultair-bridge-proto`, and fuzzing of its frame and message decoders;
  - pinning the `snow` version, and reviewing each upgrade as a security change.

  An external review of the bridge before public release covers `snow` as used here.
- **A compromised store publisher account** can ship a malicious extension update, and the update can send what it gets anywhere, because it can change the extension's CSP. Under "Once per unlock" it needs one Allow. The request code can't help here: the updated extension shows the matching code for its own request, so it gets that Allow at the user's next ordinary click. Then it can look up and fill up to the limits in §6 until the vault locks. In Firefox, a grant may also survive the update itself. Under "Never" it needs no Allow. The limits bound it, and the notices and the activity list show it. H9 reduces the chance.
- **With authenticator-code fill on**, the same extension or a stolen extension key gets the current code as well as the password for an origin: a full login, not half of one. That is why it is off by default and why H2 can require Windows Hello for code fills.
- **Metadata.** `match` returns titles and usernames for the current origin to the extension. That is High-sensitivity data under the threat model, limited by M8 and recorded in the activity list. The popup showing it can't be hidden from screen capture: masking (§7) covers usernames and emails in every capture mode except Off, not titles, and a fill writes the username into the page.
- **A user who confirms codes that don't match**, on both screens, pairs with whoever is in the middle.
- **Denial of service.** Anything that can reach the pipe can turn the bridge off through H7's limit, and a pipe squatter can keep it from working. Neither gets a value.
- **Reach.** Firefox ESR 140 can't install the extension (§2). Where an administrator has turned off per-user native messaging hosts, the bridge doesn't work in that browser, and Settings → Browser says so.

## Consequences

- `threat-model.md` has a "Browser extension: fill and save (proposed, not built)" section covering new assets, new attackers and the changes for each existing attacker. It is written for review before code (checklist §2). It also lists every statement in the docs that changes if this ships, with the new wording.
- `security-assumptions.md` gains: the browser's extension sandbox, the Native Messaging launch rules, store update integrity, the Windows pipe security model, and that the Windows Hello consent check is a yes-or-no answer from Windows.
- `vault-format.md` gains a section for the bridge file and the `BRIDGE_KEY` derivation in §5. `local-data-storage.md` gains the bridge file, the helper, its manifest and registry keys, and the extension's two keys in the browser profile.
- `SECURITY.md` covers the extension and the host.
- **Build guards.**
  - `deny.toml` gains the `wasm32-unknown-unknown` target in `[graph].targets`, so `vaultair-bridge-wasm`'s dependencies are checked too. No ban is lifted: `snow` and tokio's named pipes are not network clients.
  - Injection targets are restricted to two forms: `target: { tabId, frameIds: [0] }` for the probe (step 1 of "Pinning the page", §7) and `target: { tabId, documentIds: [...] }` for every other injection. A lint rule in `extension/` refuses every other form (no `allFrames`, no bare `tabId`), any `world` other than the isolated one, and any use of the storage API inside an injected function.
  - `scripts/check-release-config.mjs` gains checks of the extension manifest: the permissions are exactly the four in §2, the minimum browser versions are at least those in §2, and the CSP is exactly the one in §2. A lint rule in `extension/` refuses any use of `storage.sync` or `indexedDB`, and any `storage.local` key other than the pairing record.
  - CI builds `vaultair-bridge-wasm` for `wasm32-unknown-unknown` and fails on a `getrandom` without a browser backend or with the `custom` backend. A test drives a Noise_KK session between the native and WASM builds of `vaultair-bridge-proto` under Node, and the Playwright stage repeats it in a real Chromium extension service worker. Protocol tests refuse a non-empty first handshake message and a changed session header.
  - The capability gains only the new Settings commands.
- **Prerequisites from the checklist:**
  - the automatic backup before a schema migration (V9 adds the `browser_activity` list from §11 and the account's "Also fill on its website address" flag from §9);
  - golden fixtures for V9, including that an MVP build refuses the vault as too new.
- **Order of work:**
  1. Threat model and docs.
  2. `vaultair-bridge-proto` (`snow` session, session header, codec, pairing and request codes) with known-answer tests and fuzzed decoders; then `vaultair-core::bridge` with the bridge file, matcher tests and the limits; then `vaultair-bridge-wasm` with the native ↔ WASM session test.
  3. Pipe and host, with the host's user checks, and an integration test on Windows CI that includes a pipe created by another Windows user.
  4. App settings, pairing, the approval prompt, the save confirm and the Windows Hello consent check.
  5. Extension: the pairing tab and the popup; Playwright end-to-end on Chromium with real registry keys, including the service-worker session test; `web-ext` for Firefox.
  6. Signing and the signature checks (H1).
  7. Store listings: Chrome Web Store (needed for a fixed ID on Windows Chrome), Firefox AMO signing, Edge Add-ons, whose ID is added to the manifest.

## Security review (2026-10-09)

Two security reviewers read this ADR and the threat model's browser extension section on 2026-10-09: one for the channel, keys and pairing, one for the browser, page and Windows surfaces. Where they rated the same issue differently (SR5, SR8), the higher rating was used. The project owner chose the fixes for SR3, SR4, SR7 and SR15 the same day. Every finding is resolved in the design text above and in the threat model; none of it is built.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| SR1 | High | Only the app's confirm counted; the extension pinned on its peer's word | Both sides confirm, the extension in its own tab, before either pins (§5 step 4, M3) |
| SR2 | High | Abandoned pairing attempts weren't counted, so the code could be ground | Each attempt is single-use, needs the master password and counts toward H7 (§5 step 5, H7) |
| SR3 | Medium | H2 reused the quick-unlock Hello key: missing by default, and its signatures are key material | Owner's choice: Windows Hello consent check, no key (§11, H2) |
| SR4 | Medium | Vaultair's pairing private key was in backups and survived a password change | Owner's choice: kept on this PC in the bridge file, outside the vault folder, ended by a password or KDF change (§10) |
| SR5 | Medium | The first-instance flag didn't stop pipe squatting; no server check before signed releases | A taken name stops the bridge; the helper checks the pipe's user and limits impersonation from the first release (§2, M1) |
| SR6 | Medium | `match` enumerated silently; the rate limit had no number | Numbered limits per pairing, every lookup recorded, repeated entries merged so bursts can't flush the list, code limit per account (§6, M8, §11) |
| SR7 | Medium | A "Once per unlock" Allow granted every site and wasn't tied to the user's click | Owner's choice: request code in the prompt and the browser; the prompt states its real scope; one prompt at a time (§6, §11, H10) |
| SR8 | Medium | Requests weren't kept out of KK message 1; how the app picks the key was undefined | Empty handshake payloads; session header in the prologue (§6, M4, H3) |
| SR9 | Medium | Code running as the user can rewrite the extension's pinned app key | Stated as part of the "malware running as you" exclusion; fingerprint and confirm-window signs (§10) |
| SR10 | Medium | Revoke didn't drop grants, sessions or pending saves | Revoke ends everything the pairing holds; a generation counter stops an old bridge file bringing a pairing back; defined refusals that never make the extension drop its key (§6, §10) |
| SR11 | Low | Only a move to "Never" needed the master password | Settings ordered; any loosening takes the master password (§11) |
| SR12 | Low | `hello` gave away a vault id; `off` couldn't be sent | No key hint; `request_unlock` rate-limited; `unavailable` comes from the helper; the lock-state signal is stated (§6, M9) |
| SR13 | Low | The ID allowlist and client check didn't authenticate the extension; Edge has its own ID | M2 and H1 reworded; both IDs listed; Edge gets its own key (§2, M2, H1) |
| SR14 | Low | No masking in Custom mode; a fill shows the username | Masked in every capture mode except Off, with a last-used hint; the page leak is stated (§7) |
| SR15 | Low | The match set was wider than exact host | Owner's choice: `website_url` opt-in per account; IP literals and unlisted suffixes refused; curated hosts in code; ports normalized (§9) |
| SR16 | Low | A save could store a value the user didn't type | Field rules; one pending save, others `busy`; the confirm shows the request code, the length and confirm-field match (§8) |
| SR17 | Low | Malicious-update defences overstated; `storage.session` clearing claimed for every browser | `connect-src 'none'` for the published code; Firefox behaviour on update stated as undocumented; threat model row corrected (§2, §10) |
| SR18 | Low | The visibility check was easy to fake; the injection world wasn't fixed | Opacity, size, viewport and hit tests; isolated world in the lint (§7, H4) |
| SR19 | Low | IndexedDB or `storage.local`; `setAccessLevel` support unstated | `storage.local` only; Chrome and Edge 140 minimum; Firefox limit stated; `indexedDB` banned (§2) |
| SR20 | Low | Zeroization in WASM overstated; RNG wiring unspecified | Zeroization scope stated; `use-getrandom` with the `wasm_js` backend, a CI check and a service-worker test (§2, Consequences) |
| SR21 | Info | The "Statements that change" table missed several statements | Rows added in the threat model |
| SR22 | To check | Platform facts not checked against vendor docs | Checked; see below |

## Platform facts checked (2026-10-09)

| Fact | Source |
|---|---|
| `scripting` `documentIds` and `documentId`: Chrome 106, Firefox 153 (bug 1891478, shipped 2026-07-21) | [MDN compat data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/scripting.json), [bug 1891478](https://bugzilla.mozilla.org/show_bug.cgi?id=1891478) |
| Firefox 153 is the new ESR; ESR 140 is still supported | [Mozilla product details](https://product-details.mozilla.org/1.0/firefox_versions.json) |
| `setAccessLevel`: Chrome on every storage area from 140; not in Firefox. `storage.local` is open to content scripts by default; `storage.session` is trusted-contexts-only by default | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/setAccessLevel), [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage) |
| `storage.session` is in memory. Chrome clears it on disable, reload, update and browser restart; Firefox documents browser stop, disable and uninstall | [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session) |
| The action popup closes when the user focuses elsewhere | [Chrome popups](https://developer.chrome.com/docs/extensions/develop/ui/add-popup), [MDN popups](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Popups) |
| A badge shows about 4 characters | [MDN `setBadgeText`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setBadgeText) |
| KK message 1 payloads are replayable, open to key-compromise impersonation, and readable if the recipient's static key leaks; transport messages have strong forward secrecy | [Noise spec, payload security properties](https://noiseprotocol.org/noise.html#payload-security-properties) |
| Edge Add-ons IDs can differ from Chrome Web Store IDs; Edge reads its own key first and falls back to Chromium's and Chrome's | [Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging) |
| `NativeMessagingUserLevelHosts` turned off means only HKLM hosts are used, in Chrome and Edge | [Chrome policy](https://chromeenterprise.google/policies/native-messaging-user-level-hosts), [Edge policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/nativemessaginguserlevelhosts) |
| Host manifests take no arguments; Chrome and Edge pass the extension origin, Firefox the add-on id | [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging) |
| `psl` includes the private section and has `Suffix::is_known()`; it doesn't detect IP literals | [psl](https://github.com/addr-rs/psl), [psl-types](https://github.com/addr-rs/psl-types/blob/master/src/lib.rs) |
| `snow` needs `use-getrandom` for the default resolver's randomness (getrandom 0.3) and has no formal audit | [snow `Cargo.toml` and README](https://github.com/mcginty/snow) |
| `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` takes an owner window and a message; Windows 11 (build 22000) and later | [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nf-userconsentverifierinterop-iuserconsentverifierinterop-requestverificationforwindowasync), [`UserConsentVerifier`](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier) |
| `checkVisibility` `opacityProperty` and `visibilityProperty`: Chrome 121, Firefox 122 | [MDN compat data](https://unpkg.com/@mdn/browser-compat-data/data.json) |
| `FILE_FLAG_FIRST_PIPE_INSTANCE` fails with `ERROR_ACCESS_DENIED` if any instance exists; tokio's `ClientOptions` default to `SECURITY_IDENTIFICATION` with `SECURITY_SQOS_PRESENT` | [`CreateNamedPipe`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea), [tokio source](https://docs.rs/tokio/latest/src/tokio/net/windows/named_pipe.rs.html) |
| Without host permissions, extension requests are ordinary cross-origin requests, which can still send data | [Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) |
| The same manifest `key` gives the same extension ID | [Chrome manifest `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key) |

## Still open

Nothing blocks acceptance. These behaviours aren't documented, and the design assumes the worse case for each; a test at implementation pins each one down:
- whether Firefox clears `storage.session` on an extension update (a `web-ext` test; the threat model assumes it doesn't);
- whether the popup closes when another app's window takes focus (the design keeps state in the background script and the code on the badge either way);
- whether another Windows user can create Vaultair's pipe name first (the Windows CI test in step 3 assumes yes);
- whether a client that leaves out `SECURITY_SQOS_PRESENT` can be impersonated (the helper always sets it);
- whether `psl` gives an IP literal a suffix (the matcher refuses IP literals before calling it);
- the exact switch that selects `getrandom` 0.3's `wasm_js` backend (the CI check and the service-worker test prove the build works).
