# Security policy

Vaultair is a local-only password vault for Windows. If you find a way to get at vault data that the design says should be protected, please report it privately so it can be fixed before anyone else learns of it.

Vaultair is maintained by one person. This policy promises only what one person can keep.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to <https://github.com/bubb4rd/vaultair/security/advisories/new>. The report is visible only to you and the maintainer.

Please don't open a public issue, pull request or discussion for a vulnerability, and don't post details anywhere else until a fix is out or a date has been agreed.

If the button isn't there, open an issue that says only that you have a security report, with no details, and a private channel will be arranged.

## What to include

- The commit or build you tested, and your Windows version.
- Whether Windows Hello unlock was on, and whether the PC has a TPM, if either matters.
- Steps to reproduce, from a fresh vault if you can.
- What an attacker gains, and what they need first (the vault files, a backup, a locked or unlocked session, code running as the user).
- A proof of concept, if you have one.

Reproduce with a throwaway vault or the built-in demo vault. Don't send a real vault, a real backup, a real master password or real account details.

## Supported versions

There is no release yet. Only the current `main` branch is supported, and fixes land there. This section will change when the first build ships.

## Scope

The scope follows the [threat model](docs/threat-model.md), with the details behind it in the [security assumptions](docs/security-assumptions.md). Windows Hello unlock is covered by [ADR-0005](docs/adr/0005-quick-unlock.md). The file formats are in [`docs/vault-format.md`](docs/vault-format.md).

### In scope

Anything that breaks a protection the threat model claims. For example:

- Reading vault data from the vault files or a backup without the master password.
- Vault data written unencrypted to disk: in the vault files, a backup, a temp file, the app config or browser storage.
- A secret (a password, TOTP key, backup code, recovery instruction or sensitive note) reaching a log, an error message, the search index or the relationship map.
- A changed vault header, or one with weakened key derivation settings, being accepted.
- Reading data while the vault is locked, keys that survive a lock, or auto-lock not firing on idle, Windows session lock or sleep.
- A copied value that isn't cleared at its timeout, or isn't marked to stay out of Windows clipboard history and cloud clipboard.
- Screen-capture protection that is on and doesn't hide the window from ordinary capture tools.
- Vault content running as script in the app, the window loading anything other than the app itself, or a secret reaching the interface without the user revealing it.
- Vaultair's own code making a network connection.
- Windows Hello unlock: opening the vault without a Hello approval, getting Vaultair to skip the master password when its own rules require it, or the device slot ending up in the vault folder or a backup.
- A mistake in how the cryptography is used, or bias in the password generator.
- A vulnerability in a dependency, when you can show it affects Vaultair.

### Known limitations, not vulnerabilities

The threat model says plainly that Vaultair does not protect against these, so they don't need a report:

- Code already running as the user, or a compromised Windows, driver or firmware: malware on an unlocked computer, keyloggers, and screen-capture malware.
- Traces of keys or secrets in memory. Wiping is best-effort, and the places it can't reach are listed.
- Third-party clipboard managers that ignore the "don't record" markers, any program reading the clipboard while a value is on it, and a crash before the clear.
- A revealed secret staying on screen until it auto-hides or the vault locks.
- Copying by hand out of a field you can type in (a secret being typed with its eye icon on, or sensitive notes or recovery steps opened for editing): that is an ordinary Windows copy, not marked and not cleared. A secret Vaultair is showing is a different matter: it is not selectable text, and the design is that a copy, cut or drag that reaches one anyway is stopped and either sent through the protected path or dropped. That second layer has been tested only in a test DOM, not in the real window, so if you can get a shown secret onto the clipboard by hand without those protections, that is worth a report.
- Guessing a weak master password offline from stolen vault files or a backup, and old backups still opening with the old master password after a change.
- No recovery of a lost master password. That is by design.
- The vault header showing that a file is a Vaultair vault, when it was created and its key derivation settings, and a backup's file name showing the vault's name and the backup's date.
- Windows Hello unlock's documented limits: the restart, 7-day and 3-attempt rules are enforced by Vaultair and not by the key, the failed-attempt count can be edited, malware can raise a Hello prompt and hope it's approved, a short Hello PIN or a PC without a TPM weakens it, and for 5 minutes after the master password is typed it can be turned on with a Hello approval alone.
- The lock screen's wait after wrong passwords being cosmetic, and idle lock coming up to 15 seconds late (it is counted from the last activity the app reported; it never comes early).
- WebView2's own behaviour, and encrypted files leaving the machine when a vault or backup is kept in a cloud-synced folder.

If you can go further than a documented limit allows, or show that one of these is worse than the docs say, that is worth reporting.

## Testing

- Test only on your own machine, with vaults you created. Never try anything against another person's vault, backup or computer.
- Don't try to get anyone's master password, Windows Hello PIN or vault files by deception.

## What to expect

- An acknowledgement, usually within 7 days. A single maintainer can be away, so it may sometimes take longer.
- An honest answer on whether it will be treated as a vulnerability, and why.
- Updates as a fix progresses. There is no fixed time to fix: it depends on severity and on how deep the change goes.
- Credit in the fix's notes if you'd like it, or none if you prefer.

There is no bug bounty, and no CVE process is in place.
