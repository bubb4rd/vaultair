# ADR-0008: Updates through a separate updater program

- **Status:** Proposed. Nothing here is built. Building it is Phase 19 work (`roadmap.md`), after code signing ([#42](https://github.com/bubb4rd/vaultair/issues/42)), which the updater depends on.
- **Date:** 2026-11-16
- **Supersedes, once accepted:** ADR-0004 decision 15, "Auto-updates: None in the MVP". The rest of decision 15's note stays: the installer still carries the WebView2 runtime (`offlineInstaller`) and downloads nothing.
- **Decided by:** project owner (2026-10-09): option E and the bundling, recorded in `roadmap.md` ("Updates"). The answers under "Decision" items 3–9 are proposed here and wait on the owner's acceptance.

## Context

Vaultair makes no network connections, so it can't tell anyone that a fix is out. Every build reaches people by hand (`release.md`, step 7). That worked for a private beta. v0.1.1 is a case where it doesn't scale: it fixes a SQLite flaw and five seroval issues, and a tester who never reads the release message keeps running v0.1.0.

`roadmap.md` compares six ways to update (A–F). The owner chose **E, a separate updater program**: the vault app keeps every no-network guard it has, and a second program makes the only connection, only when the user has turned updates on.

An updater is the one component that can replace `vaultair.exe` on every PC that runs it. Whoever can make it accept a build owns every vault the next time it's unlocked. So the questions that matter are who can sign an update, and what the updater checks before it runs anything.

## Decision

1. **A separate program, `vaultair-updater.exe`, in its own crate `crates/vaultair-updater`.** It never depends on `vaultair-core`, so it can't open a vault, and the app never depends on it. It has no webview: its few screens are native Windows task dialogs, so it doesn't load WebView2 or run any web code.

2. **One installer carries both programs** (decided). They are shipped through Tauri's `bundle.externalBin`. Installing the updater isn't the same as running it: it does nothing until the user turns updates on. Uninstalling removes both.

3. **The app starts the updater and learns nothing back.** **Check for updates** in Settings > About runs the updater, from the folder `vaultair.exe` is in, with `std::process::Command`. No arguments carry data, and nothing is read from it. `tauri-plugin-shell` and the Tauri updater plugin stay banned.

4. **Two independent signatures, and the updater checks both.**
   - **The update manifest** (`latest.json`: version, installer file name, size, SHA-256) is signed with an **Ed25519 update key**. The updater has the public key compiled in. The private key is kept offline by the owner and is never in GitHub's secrets. The manifest is signed on the owner's PC at `release.md` step 6, after the installer from the draft has been tried, and uploaded to the draft before it's published. A compromised CI run, workflow or GitHub token therefore can't produce an update that installs.
   - **The installer** must carry a valid Authenticode signature (#42) whose signer is Vaultair's Artifact Signing identity, checked with `WinVerifyTrust` and the signer's name.
   - The installer runs only if its SHA-256 matches the signed manifest and its Authenticode check passes.
   - **If one key leaks**, the other still blocks a fake update. The response is to rotate the leaked key (item 9) and say so in a security advisory.
   - **If both leak**, nothing in the updater can tell a fake update from a real one. That's why the update key never goes near CI.

5. **Never a lower or equal version.** The updater refuses a manifest whose version isn't strictly higher than its own. The updater and the app are built from the same tag, so its version is the app's. This refuses a replayed old manifest, and so blocks pushing users back to an older, vulnerable build.

6. **The updater never closes the app.** If `vaultair.exe` is running, the updater asks the user to lock Vaultair and quit, and waits. It then starts the installer and exits, so it never has to replace itself while running. The next installer replaces both programs.

7. **Vaults are not the updater's business.** A newer app upgrades a vault on unlock, and makes the backup before a migration first (ADR-0004, "The backup before a migration"). Going back to an older build means restoring that backup with the older build, which refuses a newer vault as "too new". The updater writes nothing near a vault.

8. **Off by default, asked once, never silent.**
   - The first time Settings > About is opened after an update that includes the updater, it asks once whether to check for updates, with **No** as the default.
   - **The choices are:** off; check when I click; or check when Vaultair starts, at most once a day.
   - **No scheduled task, service or Run key**, so nothing runs when Vaultair doesn't. This is narrower than the roadmap's "a schedule the user picks", because a schedule needs something that starts by itself.
   - **The updater always asks before downloading and before installing.**
   - **Its settings and downloads are in `%LOCALAPPDATA%\Vaultair\updater.json` and `%LOCALAPPDATA%\Vaultair\updates\`.** A download is deleted after it installs, and so is one that fails a check.

9. **Where it connects, and what the other side sees.**
   - **Where:** it fetches `latest.json` and the installer from GitHub Releases, over HTTPS, checked against the Windows certificate store.
   - **What it sends:** the request carries a fixed user agent, `vaultair-updater`, with no version, so GitHub sees the IP address and the time, and that the manifest was fetched.
   - **Pre-releases are skipped:** GitHub's "latest release" ignores them. So the updater only finds full releases, which means 1.0 and on (`roadmap.md`, Phase 19).
   - **Key rotation:** the updater accepts a short list of compiled-in public keys. A rotation ships the new key in a release signed with the old one, and a later release drops the old key.

10. **The guards change narrowly.**
    - **`deny.toml`:** the HTTP client and TLS crates the updater uses are allowed only with `wrappers = ["vaultair-updater"]`. The ban still fails the build if anything else pulls them in.
    - **A new CI check:** `cargo tree -p vaultair` must contain no network crate. That keeps "the vault app makes no network connections" checkable on its own.
    - **`scripts/check-release-config.mjs`:** the updater is the only `externalBin`, and `plugins.updater` is still refused.

## Before any code

This doesn't hold the DEK or open a channel into the app, so `future-extension-sync-checklist.md` doesn't gate it. Its rules for a first network feature still apply, and are adopted here:

- `threat-model.md` gains an "Updater" section, written and reviewed before code. It covers the assets (the install folder, and every vault through the next unlock), the attackers (a network attacker, a compromised GitHub account or CI run, a leaked key, a local program that swaps the downloaded file between the check and the run), and the answers above. A downloaded installer is checked again immediately before it runs, from a folder only the user can write to.
- `security-assumptions.md` lists what the updater relies on: GitHub Releases' availability, the Windows certificate store, `WinVerifyTrust`, the Artifact Signing identity, and the offline key.
- Every statement that becomes false is reworded in the same change:

| Statement | Where | New wording |
|---|---|---|
| "Vaultair makes no network connections, so it cannot check for updates or install them." | README, "Updating" | "Vaultair itself makes no network connections. If you turn on updates, a separate program, the Vaultair updater, checks GitHub for a newer release and asks before it downloads or installs anything." |
| "Vaultair makes no network connections, so it cannot update itself or tell you that a fix is out." | `SECURITY.md` | The same, plus: updates are off by default, so a fix still reaches people who leave them off only by hand. |
| "No network … no update checks" | `privacy-statement-draft.md`, onboarding, Settings > Privacy | "The vault app makes no network connections. Update checks are made by a separate program, only if you turn them on, and send nothing but the request." |
| "No cloud account. No network traffic from the app." | README | **Stays true** for the app. |

- `local-data-storage.md` lists `vaultair-updater.exe`, `updater.json` and `updates\`.
- `release.md` gains the manifest-signing step between trying the draft and publishing it.

## Consequences

- **A second program** to sign, review and test. It goes through the same security review as the 1.0 build (`roadmap.md`, Phase 19).
- **An extra step at every full release:** someone holding the offline update key has to sign the manifest, so a release can't be fully automated. That's on purpose.
- **Only full releases reach the updater.** Pre-releases and testers keep updating by hand.
- **People who leave updates off** are where they are today. The release message and the README still matter.
- **Some tools will see a network connection from "Vaultair"** (a firewall prompt, an antivirus log). The program's name and the privacy statement say which program it is and why.

## Rejected

- **D, the Tauri updater plugin in the app.** Puts network code in the process that holds the DEK, and loosens the CSP or a capability there.
- **A manifest that expires**, to stop an attacker freezing users on an old build. Whoever can freeze the manifest can also delete the release, and an expiry would make the owner re-sign on a timer even when nothing changes.
- **Signing the manifest in CI.** Simpler, but a compromised workflow could then publish an update that installs. The installer's Authenticode signature is made in CI (#42), so CI must not hold the second key too.
- **A scheduled task or background service for checks.** It would make the updater run when Vaultair doesn't, which is the opposite of how the app behaves today.
