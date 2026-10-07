# ADR-0005: Quick unlock with Windows Hello

- **Status:** Accepted
- **Date:** 2026-09-25
- **Supersedes:** ADR-0004 decision 10 ("Windows Hello / quick unlock: deferred")
- **Decided by:** project owner

## Context

Typing the master password at every app start and every relock is the biggest daily friction in Vaultair, and friction pushes people toward weaker habits (a short master password, or not using the vault at all). The master password must stay the root of trust: it alone derives the key that wraps the DEK, and it alone can create, restore or re-key a vault.

Options considered, against a stolen laptop, malware running as the user, a shared Windows account, and an offline copy of the vault files:

| Option | Verdict |
|---|---|
| A "session": the DEK cached across restarts under DPAPI, with a TTL | **Rejected.** DPAPI opens silently for any process running as the user, and the TTL is a stored rule rather than cryptography. It is weaker than today against malware and against a shared account. |
| Our own PIN over a TPM key (NCrypt Platform Crypto Provider) | **Rejected.** A Windows Hello PIN already is a TPM-backed PIN with anti-hammering; building our own duplicates it and shares the TPM lockout counter with every other app. |
| `UserConsentVerifier` as the gate | **Rejected as a gate.** It returns yes or no, and a patched app skips it. Used only to check availability. |
| **A Windows Hello device slot** | **Chosen.** Malware has to raise a visible Hello prompt and get the user to approve it; there is no silent path. Offline copies of the vault gain nothing. |

## Decision

1. **Opt-in Windows Hello quick unlock**, per vault and per device, enabled in Settings → Security after entering the master password.
2. **Key hierarchy.** `KeyCredentialManager` creates a non-exportable key named `Vaultair-<vault_id>` (Hello rejects `/` in names), held by Hello (in the TPM when there is one). The key signs a random 32-byte challenge, and the signature is deterministic. HKDF-SHA256 over that signature gives the wrapping key, which wraps the DEK with XChaCha20-Poly1305. The AAD binds the wrap to `vault_id` and to a hash of the current password slot.
3. **Storage.** The wrapped DEK lives in a device sidecar, `%LOCALAPPDATA%\Vaultair\devices\<vault_id>.qu`, wrapped again with DPAPI (`CRYPTPROTECT_UI_FORBIDDEN`, entropy = `vault_id`). It is **not** a slot in `vault.vhdr`. That way the vault format stays v1, nothing leaks into backups or synced folders, and `key_slots` stays reserved for slots that travel with the vault (such as a future recovery key).
4. **When the master password is still required:**
   - enabling quick unlock;
   - the first unlock after a Windows restart (the boot time is computed as now minus `GetTickCount64`);
   - more than **7 days** after the last password unlock;
   - after 3 quick unlocks in a row that fail or are cancelled;
   - after a password change, or when the Hello key is gone;
   - for sensitive actions: change password, strengthen KDF, restore a backup, set auto-lock to "never", and change or turn off quick unlock.

   Revealing and copying secrets do **not** ask for Hello; they follow the normal unlocked-session rules.
5. **Policy record.** `last_password_at` and the boot time at the last password unlock are kept in the sidecar, MACed with a key derived from the DEK. Malware can delete the record (the user then types the password) but can't extend it.
6. **Relock is unchanged.** Idle timeout, Win+L and sleep still wipe keys. The next unlock uses Hello unless one of the rules in decision 4 applies.
7. **Revocation.** A password change invalidates the sidecar automatically (the password-slot hash in the AAD changes). "Forget this device" deletes the sidecar and the Hello key. Removing Hello from Windows also revokes it.
8. **No TPM.** A Hello key that isn't hardware-backed is **allowed with a warning** at enrollment, explaining that the protection is weaker. Detect the TPM with `Tbsi_GetDeviceInfo` (TPM Base Services), not Hello attestation: the spike showed that a working firmware TPM reports attestation `NotSupported`. Attestation is logged for information only.
9. **Tray.** An optional "Keep running in the tray" setting. When it's on, closing the window hides it to the tray instead of quitting, and the tray menu has Lock and Quit. The vault stays under the same lock rules; this saves startup time only.
10. Every quick-unlock error is a static code with no dynamic data. Any Hello failure or cancel falls back to the password field.

## Consequences

- New phase **15b (Quick unlock)** after Phase 15, since it reuses the Settings screens and the change-password flow. Landing before Phase 16 means the release threat-model review covers it.
- A 1–2 day spike comes first. It checks that the Hello prompt shows in front of the frameless window, and that the signature is identical across calls on real hardware. If the signature isn't deterministic, this design is revisited before any code merges. **Spike done (2026-09-25), both checks pass:** the signature was identical within a process, across processes, after a reboot and after a PIN change, and the prompt took focus by itself in front of the window (normal, maximized and minimized), with no workaround needed. See [the spike notes](../spikes/hello-quick-unlock.md).
- `threat-model.md`, `security-assumptions.md`, `vault-format.md` (a device-sidecar section) and `implementation-plan.md` §5 are updated in Phase 15b.
- **As built (Phase 15b, 2026-10-06).** Where the code is more specific than the decisions above:
  - The wrap is bound to a hash of the whole header, so strengthening the KDF voids the slot as a password change does (both wrap the key again). After either, Vaultair deletes the slot and the Hello key, and the user turns quick unlock on again.
  - Deleting the Hello key is what revokes for good: the key can't be exported, so a copy of an old slot can never be opened again. The password-slot binding alone would not stop someone who kept a copy and can still pass Hello, because the DEK does not change.
  - **Decision 4 amended (2026-10-07, project owner): turning it on does not ask for a master password typed in the last 5 minutes.** After a master-password unlock of a vault without quick unlock, on a PC with Hello set up, Vaultair shows a small offer; "Turn on" goes straight to the Hello prompt. Rust checks the age of the password unlock (`PASSWORD_FRESH_SECS`, monotonic clock, kept in the session and gone on lock) and uses the open session's keys. Older than that, or in a session Hello opened, it answers `quick_unlock_password_required` and the dialog asks as before. The cost is in `threat-model.md`: within those 5 minutes, someone at the unlocked vault who knows the Hello PIN can turn it on. Turning it off, and every other rule in decision 4, is unchanged. The offer can be declined until Vaultair restarts ("Not now") or for good on this PC ("Don't ask again", `helloOfferDismissed` in `config.json`), and is never shown for a demo vault. Shipped in [PR #23](https://github.com/bubb4rd/vaultair/pull/23); checked by hand with real Windows Hello the same day (card, one-prompt enable, dismiss paths, password fallback, no demo offer).
  - The failure count (3 in a row) is stored in the slot without a MAC: nothing can be authenticated before the DEK is known. Editing it buys more Hello prompts, not an unlock.
  - Closing to the tray locks the vault, as quitting did. Decision 9's "same lock rules" is read as "no weaker than before". The tray menu has Open, Lock and Quit.
  - "Change or turn off quick unlock" (decision 4) covers turning it on and "Forget this device"; both take the master password. The tray switch does not.
  - The lock screen never opens Windows Hello on its own. The user clicks "Unlock with Windows Hello". After 3 failed or cancelled attempts the password form warns that Windows Hello is disabled until the master password is entered.
- Residual risks: a weak Hello PIN lowers protection on a stolen laptop to that PIN plus TPM lockout, and non-TPM Hello keys are software-protected. Both are mitigated by the enrollment warnings and the restart and 7-day password rules.
