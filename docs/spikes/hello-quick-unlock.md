# Spike: Windows Hello quick unlock

- **Status:** **done, 2026-09-25. Verdict: go.** Both parts pass, and ADR-0005 stands as written, apart from the TPM detection wording (finding 3).
- **Started:** 2026-09-25
- **Decision it de-risks:** [ADR-0005](../adr/0005-quick-unlock.md), Phase 15b in `implementation-plan.md`
- **Throwaway code:** `D:\hello-spike` (a standalone crate outside the repo, not committed). `windows = "=0.61.3"` with features `Foundation`, `Security_Credentials`, `Security_Credentials_UI`, `Security_Cryptography` and `Storage_Streams`, plus `sha2`.

## What the spike must prove

1. **Part A (console):** `KeyCredential::RequestSignAsync` returns the **same signature for the same challenge** every time: within one process, across processes, across reboots, and across a Hello PIN change. ADR-0005 derives the DEK-wrapping key from that signature (HKDF), so if the signature ever changes, the design has to change.
2. **Part B (in the app):** the Hello prompt appears **in front of** Vaultair's frameless Tauri window and has focus.

## How to run Part A

```powershell
cd D:\hello-spike        # not D:\vaultair; there, cargo run launches the app (blank window without Vite)
cargo run -- create      # enroll (ReplaceExisting), then 3 signs
cargo run                # open the existing key, then 3 signs
cargo run -- delete      # clean up
```
The credential name is `Vaultair-spike-0000` and the challenge is fixed at `[7u8; 32]`. The spike prints each status and a SHA-256 of each 256-byte signature.

## Results so far

| Step | Result |
|---|---|
| A1: `create` | **Pass.** `create: Success`. Hello prompt shown. `attestation: NotSupported` (2) |
| A2: 3 signs in one process | **Pass.** All `bee69178f523ee9290b39707fb7939f27d913f45d8a3b12ac1364b848ff89be4` |
| A3: new process, `open` + 3 signs | **Pass.** `open: Success`, same hash as A1 |
| A4: after a Windows restart, `open` + 3 signs | **Pass.** `open: Success`, same hash (prompts 4.9 s, 3.2 s, 1.5 s) |
| A5: after a Hello PIN change, `open` + 3 signs | **Pass.** `open: Success`, same hash (prompts 2.9 s, 3.2 s, 2.2 s) |
| A6: cancel each prompt | **Pass.** All 3 signs returned `UserCanceled` (3) cleanly, with no crash and no signature. The process kept going after each cancel |
| Timing | Signing itself about 5 ms (a sign right after create, with no prompt); about 2–6 s per prompt is the user approving it |

**Expected hash for every remaining step:** `bee69178f523ee9290b39707fb7939f27d913f45d8a3b12ac1364b848ff89be4`

## Part B results (in the app, branch `spike/hello`)

The debug command `spike_hello_sign` polled the foreground window every 50 ms while a request was in flight. The new key from "create" (ReplaceExisting) gave `001ec0d4…2205` on every sign in the app, 5 of 5 plus the rerun.

| Window state | Result |
|---|---|
| Normal | **Pass.** The dialog host (`Credential Dialog Xaml Host`, "Windows Security") was visible within about 50–100 ms and **became the foreground window by itself** at about 1.1–1.8 s, which is the dialog's entrance animation |
| Maximized | **Pass.** Same as normal |
| Minimized (the terminal had focus) | **Pass.** The dialog still took the foreground at about 1.2 s, and focus went back to the previous window when it closed |

- **No focus workaround is needed.** The first version of the probe reported `foreground: false` because it checked at first sighting, before the animation finished. The Bitwarden `SetForegroundWindow` fix isn't needed.
- If another window grabs focus mid-prompt (a Firefox Picture-in-Picture window did once), the dialog stays open and takes focus back. Approval still succeeded.
- Phase 15b: trigger the Hello prompt when the lock screen is shown or focused, not while Vaultair is minimized, so the prompt appears in context.

## Findings (feed back into ADR-0005 / Phase 15b)

1. **Hello rejects `/` in credential names.** `Vaultair/spike-0000` failed with `0x80090027` (`NTE_INVALID_PARAMETER`) on `OpenAsync`. Use `Vaultair-<vault_id>`. ADR-0005 already has the fix.
2. **Check every `KeyCredentialStatus` before calling `.Credential()` or `.Result()`.** Reading them on a non-success result fails with an unhelpful `HRESULT(0)`. The statuses are Success 0, UnknownError 1, NotFound 2, UserCanceled 3, UserPrefersPassword 4, CredentialAlreadyExists 5, SecurityDeviceLocked 6.
3. **Attestation doesn't reliably detect a TPM.** This PC has a working AMD firmware TPM (`Get-Tpm`: present, ready, TPM 2.0 fTPM 6.32), yet attestation reports `NotSupported`. Firmware TPMs often can't attest. Phase 15b must detect the TPM with `Tbsi_GetDeviceInfo` (TPM Base Services), show the "weaker protection" warning only when no TPM is present, and log attestation as information only. ADR-0005 decision 8 now has this wording.
4. A sign straight after `create` needs no second prompt (Windows reuses the approval), and every later sign prompts. In the real flow that's one prompt per unlock, which is fine.

## Remaining steps

- [x] **A4:** restart Windows, then `cargo run` → the hash must match. (Passed.)
- [x] **A5:** change the Hello PIN (Settings → Accounts → Sign-in options → PIN), then `cargo run` → the hash must match. (Passed.)
- [x] **A6:** `cargo run` and press Cancel → the output shows `UserCanceled` (3), with no crash. (Passed.)
- [x] **A7:** optional, because it removes Hello from Windows: remove Hello, then `cargo run` → `open: NotFound` (2). (**Skipped** by choice. `NotFound` is expected but untested. Phase 15b treats any non-success `open` as "fall back to the password, and turn quick unlock on again".)
- [x] **A8:** `cargo run -- delete`. (Done.)
- [x] **Part B:** on a throwaway branch `spike/hello`, add a debug-only `spike_hello_sign` command, called from `DevPanel.tsx`. Check the prompt shows in front with Vaultair focused, maximized, and minimized. If the prompt opens behind the window, try `FindWindowW("Credential Dialog Xaml Host")` + `SetForegroundWindow` (Bitwarden's workaround). Delete the branch afterwards.
- [x] Write the final verdict here, and update ADR-0005 (decision 8 TPM detection, spike outcome).
- [x] Clean up (done 2026-09-25; the key was deleted from the console spike, which uses the same name): in the app, click "Hello: delete" (removes `Vaultair-spike-0000`), then `git branch -D spike/hello` and delete `D:\hello-spike` (including `part-b.log`).

**Stop rule:** if any hash differs in A4 or A5, stop. ADR-0005's key derivation has to be redesigned before Phase 15b.

## Repo state at the time of writing

- Branch `phase-8`: Phase 8 is committed (`01c03d0`), and ADR-0005, the Phase 15b plan and this file are committed after it. No PR yet.
- Part B runs on the throwaway branch `spike/hello`, cut from `phase-8`. Delete it when the spike is done, and never merge it.
- Next product phase: Phase 9 (purpose labels). It needs the user's decision on the "Shared household" label first.
