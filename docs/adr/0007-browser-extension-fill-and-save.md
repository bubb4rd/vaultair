# ADR-0007: Browser extension for fill and save

- **Status:** Proposed. Nothing here is built. Work starts only when every box in [`future-extension-sync-checklist.md`](../future-extension-sync-checklist.md) ("For all of them" and "Browser extension and autofill") is ticked.
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
- game launchers, passkeys (README Phase 17), sync, and any bulk export or search through the extension.

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
  - the message enum (`deny_unknown_fields`, size caps), the frame codec and the Noise session wrapper over `snow`;
  - the pairing commitment and short-code derivation (§5).

  It enables only the `snow` features this suite needs (`use-curve25519`, `use-chacha20poly1305`, `use-blake2`), with `default-features = false`. Secrets are held in `zeroize` types.
- **`crates/vaultair-bridge-wasm`** (new) is a thin `wasm-bindgen` wrapper over `vaultair-bridge-proto` for the extension.
  - It exposes a handful of functions: start pairing, finish pairing, open a session, encrypt a request, decrypt a reply.
  - Session keys stay inside WASM memory and are zeroized when the session ends. The static private key is the exception: it is stored as bytes in IndexedDB and passed into WASM when a session opens (see Still open).
  - Random numbers come from `crypto.getRandomValues`, through `getrandom`'s browser backend.
- **`vaultair-core::bridge`** (pure Rust, `#![forbid(unsafe_code)]`) uses `vaultair-bridge-proto` and adds what needs the vault:
  - pairing records, the origin matcher, the per-session table of opaque handles;
  - the pending-save slot and the rate limiter.
- **`vaultair-platform::windows::pipe`** owns the pipe server, its security descriptor, and the peer-process and signature checks. This is the only new `unsafe`, kept in the crate that already holds it.
- **`crates/vaultair-browser-host`** is a small new binary:
  - Framing in, framing out, size caps. It exits when stdin closes.
  - It never parses message contents. Every frame after `hello` is ciphertext to it.
- **`extension/`** is a new folder in this repository: one MV3 codebase for all three browsers, with its source published here.
  - Permissions: `nativeMessaging`, `activeTab`, `scripting`, `storage`. Nothing else, and in particular no host permissions.
  - `storage` is used for two things only: the long-term pairing key in `storage.local`, and the per-unlock grant key in `storage.session` (§10). Both are set to trusted contexts only (`setAccessLevel`, where supported), so scripts injected into pages cannot read them. `storage.sync` is never used. No fill, code, password or account data is ever written to any storage area.
  - Inherits the app's ESLint bans (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, web storage for secrets). The extension needs no network.
  - Its CSP is the MV3 default plus exactly one token, `'wasm-unsafe-eval'`, which loading the bundled `vaultair-bridge-wasm` needs. No remote code, no `'unsafe-eval'`, no other source.
  - Minimum browser versions, set in the manifest: `minimum_chrome_version` `"106"` (Chrome and Edge), and `browser_specific_settings.gecko.strict_min_version` `"153.0"` (Firefox). These are the first versions where `scripting.executeScript` accepts `documentIds` and returns `documentId` in its results (Firefox: bug 1891478, shipped in Firefox 153 on 2026-07-21, also the current ESR). Older browsers can't install the extension, so there is no weaker code path for them (§7).
- **Host registration.**
  - The installer puts the helper binary next to `vaultair.exe` and registers nothing.
  - Turning the bridge on makes Vaultair write the host manifest and the `HKCU\Software\{Google\Chrome,Microsoft\Edge,Mozilla}\NativeMessagingHosts\<name>` keys. Turning it off removes them. These are per-user keys, so no administrator rights are needed. This is what keeps M11 true: with the bridge off, no browser can start the helper.
  - The manifest lists only our extension: `allowed_origins` with the fixed Chrome/Edge ID, `allowed_extensions` with the fixed Firefox ID.
  - The uninstaller also removes the keys and the manifest, in case the bridge was left on.

### 3. Security: the required minimum (ship-blocking)

Fill and save do not ship without all of these.

| # | Measure | Protects against |
|---|---|---|
| M1 | Pipe DACL grants only the current user's SID. `PIPE_REJECT_REMOTE_CLIENTS`. `FILE_FLAG_FIRST_PIPE_INSTANCE`, with the pipe created before any client can expect it | Other Windows users; remote clients; another process taking the pipe name first |
| M2 | Host manifest allows only our extension ID | Other extensions starting the host |
| M3 | Pairing with a short authentication string and a commitment (§5), confirmed in both UIs. Pairing needs the master password | An impostor inserting itself at first contact |
| M4 | Every session is Noise_KK with both static keys pinned at pairing (§6). Every message after it uses ChaCha20-Poly1305 with Noise's nonce counter | Impersonation of either side; reading or altering traffic through the host or the pipe; replay |
| M5 | Origin matched in Rust by the written rules in §9. A mismatch is a refusal | A page receiving another site's credentials |
| M6 | Fill only after a user gesture, top frame only, never submitted (§7) | Fill on load; iframe and clickjacking attacks |
| M7 | Save only after a confirm in Vaultair's own window, which shows site, username, and new account or update (§8) | Forged or unwanted writes to the vault |
| M8 | No enumeration. One origin per `match`, opaque handles that die on lock, rate limits | Bulk extraction by a compromised extension |
| M9 | Locked vault: the app answers `locked` and nothing else. No handshake runs while locked | Probing whether an account exists |
| M10 | Nothing secret is logged, cached or persisted by the host or the extension. The only exception is the extension's own pairing key and grant key (§10), which open nothing in the vault by themselves. The canary tests cover the pipe and the host | Leaks to disk |
| M11 | Off by default. With the switch off there is no pipe, no host registration and no new files, and a test proves it | Users who never turn it on paying for it |

**Fallback considered and rejected for the minimum:** a sealed box (`crypto_box_seal` to the app's pinned key) for saves only. It keeps the password confidential but does not authenticate the sender or protect fills, so M4 stays the minimum.

### 4. Security: planned beyond the minimum

These are part of the plan, not optional extras.

**Before the first public release:**

| # | Measure | Protects against |
|---|---|---|
| H1 | Signed releases (ADR-0004 decision 14), then peer checks both ways. The host checks the pipe server with `GetNamedPipeServerProcessId`, then the image path, then its Authenticode signer. The app does the same for the client with `GetNamedPipeClientProcessId` | Unsigned programs posing as Vaultair or as the host |
| H2 | Windows Hello approval, reusing ADR-0005's Hello key to sign a fresh challenge. The setting offers: saves only (the default), saves and authenticator codes, every fill, or off | A stolen extension key or a scripted confirm click: as ADR-0005 puts it, malware "has to raise a visible Hello prompt and get the user to approve it" |
| H3 | The Noise prologue binds protocol version, vault ID, pairing ID and browser kind. The app refuses versions below a minimum | Cross-vault confusion; downgrade to an older, weaker protocol |
| H4 | Fill writes only to visible, enabled `input` elements of the right type in the form the user acted on. The password goes only into `type=password`. Hidden or zero-size fields are refused | Invisible-field harvesting |
| H5 | The fill is pinned to the exact document that was checked, using `documentId` in every supported browser, and the injected function re-checks `location.origin` before writing (§7, "Pinning the page") | Navigation or reload between match and fill (time-of-check/time-of-use) |
| H6 | `http:` pages are never filled unless the stored URL is itself `http:`, and then only with a visible warning | Downgrade and network interception |
| H7 | Repeated failed handshakes disable the bridge until the user turns it on again, and Vaultair says so | Online guessing of a pairing; noisy attacks |
| H8 | Settings → Browser lists each pairing with its browser, created date, last used date and fill and save counts, plus the recent activity list (§11). Revoke deletes the pinned key on the app side; the extension is told on its next connection | Silent long-term misuse |
| H9 | Extension supply chain: pinned dependencies, minimal dependencies, no remote code (MV3 enforces it), reproducible builds checked in CI, 2FA on every store publisher account | A malicious update reaching users by a route other than the app's |
| H10 | Browser approval setting, default "Once per unlock" (§11) | A copied long-term key being used silently |
| H11 | Fill and save notices, on by default (§11) | Misuse going unnoticed |

**Later (tracked, not blocking):**
- Optional re-pairing after an app update that changes the host's signer.
- Reconsider fill and save per vault versus per app if multiple vaults become common.

### 5. Pairing

1. The user turns on the bridge in Settings → Browser and clicks Pair. The app asks for the master password, as other sensitive actions do (ADR-0005 decision 4).
2. The extension popup starts pairing. The two sides run Noise_XX, which exchanges static keys under encryption.
3. **Commitment, then the short code.** A 6-digit code alone is too short: someone in the middle could grind ephemeral keys until both legs show the same code. Pairing therefore follows the Bluetooth numeric-comparison pattern:
   1. The extension sends `H(Ne)`, a commitment to a random 32-byte nonce.
   2. The app replies with `Na`.
   3. The extension reveals `Ne`.
   4. Code = 6 decimal digits taken from `HKDF(handshake_hash ‖ Ne ‖ Na)`.

   An attacker in the middle has to commit before seeing the other side's nonce. That gives one guess per attempt, at 1 in 10⁶, and every attempt is a pairing the user can see.
4. Both screens show the code. The user confirms in Vaultair's window; confirming in the extension alone does not count. Each side then pins the other's static key.
   - **An unconfirmed pairing expires after 5 minutes.** The 5 minutes count from when the master password is accepted in step 1, on the monotonic clock. After that, the app discards the handshake state and both nonces, the code disappears from both screens, and the user starts again. A lock or closing the pairing dialog discards it at once. One unconfirmed pairing exists at a time.
   - **A confirmed pairing lasts until it is revoked** (H8) or the vault is restored (§10). It has no expiry of its own.
5. A pairing belongs to one vault and one browser profile. Pairing two browsers or two vaults means pairing twice.

### 6. Session

- Before the handshake, only `hello` exists. The extension sends `hello`. The app answers with one of:
  - `{ state: "locked" }`
  - `{ state: "unlocked", key_hint }`, where `key_hint` is 8 bytes of the hash of the app's static public key, so the extension can pick the right pinned key
  - `{ state: "off" }`

  `request_unlock`, also sent before the handshake, only brings the Vaultair window to the front. Nothing else is answered without a session.
- The handshake is Noise_KK (`Noise_KK_25519_ChaChaPoly_BLAKE2s`, `snow` on both ends), with the prologue from H3. A new ephemeral key each session gives forward secrecy.
- **One session per gesture.** Each click or shortcut opens a new session and closes it when the fill, code fill or save is done. Chrome stops an idle extension service worker after a short time, which wipes its memory, so no session state is kept between gestures. A KK handshake is one round trip, so this costs nothing the user notices.
- **Which static key the extension uses** depends on the browser approval setting (§11). Under "Never", it is the long-term pairing key. Under "Once per unlock", it is the grant key for this unlock once one has been approved, and the long-term key only to ask for that approval. Under "Always", it is the long-term key, with an approval for every session.
- **Messages inside a session.** Each one has a fixed schema with size caps. Unknown fields or types end the session.

  | Message | Reply |
  |---|---|
  | `match { origin }` | `[{ handle, title, username }]` for that origin only |
  | `fill { handle }` | `{ username, password }` |
  | `totp { handle, method_id? }` | `{ code, seconds_remaining }`; only when authenticator-code fill is on (§7) |
  | `save_begin { origin, username, password }` | `{ pending_id }`; the app shows its confirm |
  | `save_status { pending_id }` | `confirmed`, `rejected` or `expired` |
  | `bye` | none |

- **On lock**, the app ends every session and clears the handle table and any pending save. The extension sees the pipe close.
- **Auto-lock.** Fills, authenticator-code fills and saves do not count as activity. They never call `SessionManager::touch`, so only activity in Vaultair's own window moves the idle deadline, and a browser cannot keep the vault open. With the 5-minute default, the vault will often be locked when the user reaches a login page. The popup then offers `request_unlock`.

### 7. Fill rules

- Triggered only by the toolbar button, the keyboard command or the popup. With `activeTab`, the extension can only touch a page after one of these.
- The origin sent to the app is confirmed by the browser, not taken from page content alone (see "Pinning the page" below). Only the top frame is used; `activeTab` does not reach cross-origin iframes.
- More than one match: the popup lists title and username and the user picks one. Exactly one: the popup still shows it before filling. The fill never happens without a choice the user can see.
- **The popup can't be hidden from screen capture,** because it is browser UI. So while screenshot protection is "Always on" (the default) or "Hide emails" is on, Rust masks usernames and emails in the `match` reply before sending it, with `redact_username` / `redact_email` (for example `N****l`). The unmasked value never reaches the extension. Titles are shown as they are.
- H4 and H5 apply. Nothing is submitted.
- The password exists in the extension only in a local variable in the background script, for the length of the injection call. It is never written to `storage` or IndexedDB, and never sent to the popup.

**Pinning the page (H5).** Every gesture runs these steps, for fill, code fill and save alike:

1. **Probe.** `scripting.executeScript` with `target: { tabId, frameIds: [0] }` runs a probe in the top frame. It returns `location.origin` and a description of the form fields; it reads values only for a save. The browser's `InjectionResult` carries that document's `documentId`.
2. **Agree on the origin.** The background script reads `tabs.get(tabId).url`, which `activeTab` allows. Its origin must equal the probe's `location.origin`; if not, the gesture is refused and the popup says the page changed. Only the agreed origin goes to the app.
3. **Pinned fill.** The fill runs with `target: { tabId, documentIds: [documentId] }`. If that document is gone (a navigation, a reload, a closed tab), the browser refuses the injection and nothing is written. A `documentId` survives only same-document changes (`history.pushState`, fragment changes, a back/forward-cache restore), and none of these can change the origin.
4. **Last check.** Inside the pinned document, the fill function confirms that `location.origin` still equals the agreed origin and that the probed fields are still present, visible and enabled (H4). Otherwise it writes nothing.

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
- It is filled into one visible, enabled input: the one the user focused, or the only one with `autocomplete="one-time-code"`. H4 and H5 apply, and nothing is submitted.
- At most one code per handle per TOTP period.
- H2 offers Windows Hello approval for code fills.
- Backup codes are never filled. They stay copy-only in Vaultair.

### 8. Save rules

- Triggered by "Save to Vaultair" in the popup. The injected script reads the username and password fields of the form the user is on: the focused form, or the only one with a password field. No content script watches submissions.
- The probe and origin agreement from "Pinning the page" (§7) run first. The origin in `save_begin` is the agreed origin, never one the page reports by itself alone.
- The password goes to the app inside the Noise session and is held in Rust in zeroizing memory, as a pending save. The pending save expires after 2 minutes and is dropped on lock.
- Vaultair's own window, under the current screenshot-protection policy, shows:
  - the site host, the username, and "New account" or "Update <account title>";
  - never the password, behind a Show button or otherwise.

  Confirm needs a click there, plus Windows Hello under H2.
- **Update.** The previous password is kept, not overwritten. It moves to a hidden custom field "Previous password (<date>)" so a bad or mistaken save can be undone. `password_changed_at` is set.
- **New account.** `login_url` is set from the origin through `validation::web_url`, the account type is `website`, and the default purpose is used. The user can edit everything afterwards.
- The vault's single writer stays the open app process, so the single-writer box in the checklist holds as it is.

### 9. Origin matching

- Stored URLs come from, in order: the account's `login_url`, then its `website_url`, then the platform catalog's `default_login_url`.
- Scheme must match (see H6), and so must the port.
- Hosts are compared as lowercase ASCII. Browsers report IDN hosts as punycode, and `validation::url_host` accepts only ASCII, so a homograph lookalike does not equal a stored host.
- The default is an exact host match. Two widenings are planned:
  - **Per account:** "Match the whole domain". It matches any host under the same registrable domain, with the Public Suffix List compiled in (the `psl` crate, no network), and never across registrable domains.
  - **Per catalog platform:** a curated host list (for example Steam's store, login and community hosts), reviewed like any catalog data.
- Table tests must refuse:
  - `steampowered.com.evil.example`, `evil-steampowered.com`, a trailing dot;
  - userinfo, an `xn--` lookalike;
  - `http` against an `https` record, a port change, and a suffix-only domain such as `co.uk`.

### 10. Keys, storage and revocation

| Key | Where it lives | Available when |
|---|---|---|
| App static X25519 key, one per vault | New `browser_pairing` table inside SQLCipher (V9 migration), private key under the field key like other secrets | Only while that vault is unlocked |
| Pinned extension public keys | Same table, one row per pairing | Only while unlocked |
| Extension long-term pairing key, plus the pinned app keys | `storage.local`, trusted contexts only. Documented by Chrome and MDN to survive clearing cache and history; removed on uninstall | While the browser profile is readable |
| Extension grant key (§11, "Once per unlock" only) | `storage.session`: in memory only, cleared on browser restart, extension reload or update, and never written to disk | From approval until Vaultair locks or the browser restarts |
| Pinned grant public key | App memory only, in the unlocked session | Until the vault locks |

- No header key slot. The extension never holds the DEK or any key that opens the vault, so `vault-format.md` stays v1.
- **Backups.** A backup carries the `browser_pairing` table. A restore to a new folder keeps pairings that point at the old vault ID. Restore therefore clears `browser_pairing`, and the user pairs again.
- **Revocation.** Revoke deletes the row, and a password change leaves pairings alone. Revocation is complete: since the extension never had vault data beyond the fills it was given, there is no stored copy to recall.
- **Losing the extension's keys** (uninstall, a reset of the browser profile, or a corrupted `storage.local`, which Firefox resets automatically) loses no vault data. The user pairs again.

### 11. Browser approval and notices

**Browser approval.** A copied long-term pairing key, by itself, would let a program run as the user and ask for fills for sites it names, without the click the extension requires. The browser approval setting decides how much a Vaultair approval is needed on top of the key. It is a per-vault setting in Settings → Browser, stored inside the vault (in `vault_settings`, not `config.json`), so a program that can edit files cannot weaken it.

| Setting | What needs an Allow in Vaultair's own window | A copied long-term key alone gets |
|---|---|---|
| **Always** | Every session: each fill, code fill and save request | Nothing without a visible prompt per request |
| **Once per unlock** (default) | The first session from each paired browser after each unlock | Nothing without a visible prompt, which the user did not ask for |
| **Never** | Nothing beyond the pairing | Fills and code fills for any site it names, while the vault is unlocked. Saves still need M7's confirm |

- **The prompt** names the browser and the site host of the request, for example "Chrome wants to fill a login on store.steampowered.com." It offers Allow and Deny, and it times out as a Deny after 2 minutes. Under "Always", a save's own confirm (M7) counts as the approval for that session, so the user is not asked twice. When H2 asks for Windows Hello on the same request, Hello follows the Allow.
- **"Once per unlock" mechanics.**
  1. After the user clicks Allow, `vaultair-bridge-wasm` creates a fresh X25519 grant key pair and sends its public half inside that session.
  2. The app pins the grant public key in memory until the vault locks.
  3. The extension keeps the grant private key in `storage.session` only.
  4. Later sessions in the same unlock use the grant key as the extension's static key in Noise_KK and need no prompt.

  A lock forgets the grant on the app side, and a browser restart forgets it on the extension side. Either way, the next session asks again.
- **Changing the setting.** Moving to a stricter setting takes effect at once, and an existing grant is dropped. Moving to "Never" takes the master password, like the other actions that lower protection (ADR-0005 decision 4), and the screen says what a copied key could then do.
- **Denied or timed-out prompts** count toward H7's failed-attempt limit.

**Fill and save notices.** A per-vault setting "Show fill and save notices", on by default. The user can turn it off and on again at any time in Settings → Browser, without the master password.
- **What a notice shows.** Each fill, code fill and save shows a Windows notification with generic text only, for example "Vaultair filled a login in Chrome" or "Vaultair saved a login from Firefox." It never shows a site, account title, username or value. Windows keeps notification history in its own unencrypted database, and notifications can't be hidden from screen capture.
- **Where the details live.** The details (time, browser, kind, account, site host) go to the recent activity list in Settings → Browser. That list is stored inside the vault, keeps the last 100 entries, and is kept whether notices are on or off.
- **When there's no notification.** If Windows suppresses notifications (Focus Assist, notifications off for Vaultair), the activity list is still written. With approval set to "Never", the notices and the activity list are the only signs of use, and the "Never" screen says so.

## Residual risks (to state in `threat-model.md`)

- **Malware running as the user** can read the extension's `storage.local`, replace the host binary in the per-user install folder, or drive the browser. Pairing does not change the existing "does NOT protect against" entry.
  - Under "Always" and "Once per unlock" (§11), a copied long-term key alone can't fill or save without a visible Vaultair prompt.
  - Under "Never", it can fill silently while the vault is unlocked. Only the notices and the activity list show it.
  - Malware that reads the browser's memory can also take a live grant key.
  - H2 means saves still need a visible Hello approval.
- **A filled password is in the page's DOM.** Scripts on that same origin, including an XSS, can read it, as they could if the user typed it.
- **`snow` has no formal audit**, as its README states. Every part of the channel rests on it, on both ends. Mitigations:
  - `snow`'s own cacophony test vectors and fuzzing;
  - our own known-answer tests in `vaultair-bridge-proto`, and fuzzing of its frame and message decoders;
  - pinning the `snow` version, and reviewing each upgrade as a security change.

  An external review of the bridge before public release covers `snow` as used here.
- **A compromised store publisher account** can ship a malicious extension update. M8 limits what it can take to one origin per request, with each fill visible to the user. H9 reduces the chance.
- **With authenticator-code fill on**, the same extension or a stolen extension key gets the current code as well as the password for an origin: a full login, not half of one. That is why it is off by default and why H2 can require Windows Hello for code fills.
- **Metadata.** `match` returns titles and usernames for the current origin to the extension. That is High-sensitivity data under the threat model, limited by M8. The popup showing it can't be hidden from screen capture; masking (§7) covers usernames and emails, not titles.

## Consequences

- `threat-model.md` has a "Browser extension: fill and save (proposed, not built)" section covering new assets, new attackers and the changes for each existing attacker. It is written for review before code (checklist §2). It also lists every statement in the docs that changes if this ships, with the new wording.
- `security-assumptions.md` gains: the browser's extension sandbox, the Native Messaging launch rules, store update integrity, and the Windows pipe security model.
- `SECURITY.md` covers the extension and the host.
- **Build guards.**
  - `deny.toml` gains the `wasm32-unknown-unknown` target in `[graph].targets`, so `vaultair-bridge-wasm`'s dependencies are checked too. No ban is lifted: `snow` and tokio's named pipes are not network clients.
  - Injection targets are restricted to two forms: `target: { tabId, frameIds: [0] }` for the probe (step 1 of "Pinning the page", §7) and `target: { tabId, documentIds: [...] }` for every other injection. A lint rule in `extension/` refuses every other form (no `allFrames`, no bare `tabId`).
  - `scripts/check-release-config.mjs` gains checks of the extension manifest: the permissions are exactly the four in §2, the minimum browser versions are at least those in §2, and the CSP adds nothing but `'wasm-unsafe-eval'`. A lint rule in `extension/` refuses any use of `storage.sync` and any `storage.local` key other than the pairing record.
  - CI builds `vaultair-bridge-wasm` for `wasm32-unknown-unknown`. A test drives a Noise_KK session between the native and WASM builds of `vaultair-bridge-proto`, under Node, to prove the two builds agree.
  - The capability gains only the new Settings commands.
- **Prerequisites from the checklist:**
  - the automatic backup before a schema migration (V9 adds `browser_pairing` and the `browser_activity` list from §11);
  - golden fixtures for V9, including that an MVP build refuses the vault as too new.
- **Order of work:**
  1. Threat model and docs.
  2. `vaultair-bridge-proto` (`snow` session, codec, pairing code) with known-answer tests and fuzzed decoders; then `vaultair-core::bridge` with matcher tests; then `vaultair-bridge-wasm` with the native ↔ WASM session test.
  3. Pipe and host, with an integration test on Windows CI.
  4. App settings, pairing and the save confirm.
  5. Extension: Playwright end-to-end on Chromium with real registry keys; `web-ext` for Firefox.
  6. Signing and the H-measures.
  7. Store listings: Chrome Web Store (needed for a fixed ID on Windows Chrome), Firefox AMO signing, Edge Add-ons.

## Still open

Nothing. The last item, Firefox support for `documentIds`, is settled in §2 (minimum versions) and §7 ("Pinning the page"): Firefox 153 supports it, so there is no fallback path.
