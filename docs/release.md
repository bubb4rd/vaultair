# Releasing

> **Status:** written for v0.1.0 (2026-10-07), the first build. Every release is an unsigned pre-release until code signing is in place (ADR-0004, decision 14).

A release is a version tag on `main`. Pushing the tag makes GitHub Actions build the installer and attach it to a **draft** pre-release. Nothing is public until you have tried that installer and published the draft.

There is no updater (ADR-0004, decision 15). Testers get a new build by downloading it, so every release needs telling people about.

## Cut a release

1. **Bump the version** on a branch. It lives in three places and all must match:
   - `Cargo.toml`, `version` under `[workspace.package]`. The three crates inherit it, and Settings > About shows it.
   - `src-tauri/tauri.conf.json`, `version`. It names the installer.
   - `package.json`.

   ```powershell
   npm version 0.1.1 --no-git-tag-version   # package.json and package-lock.json
   # edit Cargo.toml and src-tauri/tauri.conf.json by hand, then:
   cargo update --workspace                  # Cargo.lock, workspace crates only
   npm run check:release-version
   ```

   The check fails while any of them, or either lockfile, still has the old number. CI runs it too.
2. **Merge to `main`** through a pull request, and wait for CI to pass on the merge commit.
3. **Tag that commit and push the tag.** The tag is `v` and the version, nothing else.

   ```powershell
   git switch main
   git pull --ff-only
   git tag -a v0.1.1 -m "Vaultair 0.1.1"
   git push origin v0.1.1
   ```

4. **Wait for the Release workflow** (`.github/workflows/release.yml`). It refuses a tag that doesn't match the version or isn't on `main`, runs the release-config check, builds with `npx tauri build -- --locked` from the lockfiles with no build cache, and creates a draft pre-release holding `Vaultair_<version>_x64-setup.exe` and `SHA256SUMS.txt`.
5. **Try the installer from the draft.** Download it, compare its SHA-256 with `SHA256SUMS.txt`, install it, and go through the smoke path by hand: create a vault, add an account, copy a password, lock, unlock, make a backup. Install over the previous version at least once, and check that an existing vault still opens.
6. **Publish the draft.** Edit the generated notes first: say what changed, and keep the SHA-256 and the link to the install steps. Leave **Set as a pre-release** ticked.
7. **Tell testers.** Send the release link with the three things they need to know:
   - Windows SmartScreen will say "Windows protected your PC", because the installer isn't signed yet. **More info**, then **Run anyway**.
   - Vaultair never updates itself. A newer build is installed by downloading it and running it.
   - Updating and uninstalling leave vaults, backups and settings alone.

   The README's Install section says the same, for anyone who arrives without the message.

8. **Add a golden fixture** if the release ships a new schema version (a migration) or a new file format: generate it from the tag, as `vault-format.md` §10 describes, and merge it through a pull request.

## If something is wrong

- **The workflow failed, or the draft's installer is bad.** Nothing is public yet. Delete the draft and the tag (`gh release delete v0.1.1 --cleanup-tag`), fix `main`, and tag again.
- **The release is already published.** Don't move or reuse the tag: people may have that installer, and its SHA-256 is in the notes. Fix `main` and release the next patch version.

## Building a release by hand

v0.1.0 was made this way, before the workflow existed. It remains the fallback if Actions is unavailable.

Build from a clean checkout of the tag, not from a working tree with other changes in it:

```powershell
git worktree add --detach ..\vaultair-release v0.1.1
cd ..\vaultair-release
npm ci
npm run check:release-config
npx tauri build
Get-FileHash target\release\bundle\nsis\Vaultair_0.1.1_x64-setup.exe -Algorithm SHA256
gh release create v0.1.1 target\release\bundle\nsis\Vaultair_0.1.1_x64-setup.exe --verify-tag --draft --prerelease --title "Vaultair 0.1.1" --generate-notes
```

Put the SHA-256 in the notes. In PowerShell a bare `--` is swallowed before `npx` sees it, so `npx tauri build -- --locked` only works from Git Bash; the workflow runs that step in bash for this reason.

The first build fetches Microsoft's WebView2 runtime installer onto the build machine, because the installer carries it (`webviewInstallMode: offlineInstaller`). That is a download on the build machine only.

## Not done yet

### Code signing

Decision 14: unsigned for the private beta, and a certificate before any public release. The project owner chose **Azure Artifact Signing** (formerly Trusted Signing) on 2026-10-09; the work is [#42](https://github.com/bubb4rd/vaultair/issues/42). Until it ships:

- releases stay marked as pre-releases, and `release.yml` passes `--prerelease`;
- the README and `SECURITY.md` say the installer is unsigned and that SmartScreen will warn.

What it needs and how it fits:

- A paid Azure subscription (free, trial and sponsored ones are refused), an Artifact Signing account, a Public Trust identity validation done in the Azure portal, and a Public Trust certificate profile. Public Trust is open to individual developers in the US and Canada, and to organizations in the US, Canada, the EU and the UK.
- Tauri signs through `bundle.windows.signCommand` in `tauri.conf.json`, calling SignTool with the Artifact Signing client (or `trusted-signing-cli`). Both `vaultair.exe` and the installer need signing. The certificates are short-lived, so every signature must carry a timestamp.
- The signing credentials belong in a GitHub environment that needs approval, used only by the tag build, so a pull request's dry run never sees them.
- Signing and timestamping contact the certificate provider from the build machine. The app's no-network promise is about the app, and is unchanged.
- Afterwards, take `--prerelease` out of `release.yml`, and update the README's Install section, `SECURITY.md` ("Official builds") and the Phase 16 notes (internal, not in this repository).

A signature names the publisher. SmartScreen's warning is tied to reputation as well, so it may not disappear with the first signed build.

### E2E smoke test in CI

The plan (Phase 16) calls for `tauri-driver` with WebdriverIO on Windows, driving the path in step 5. It doesn't exist yet, so step 5 is done by hand for every release. When it exists it should run against the release build before the draft is created.

### Install test on a clean PC

No install has been recorded on a PC without WebView2, which is the case the bundled runtime installer is there for.
