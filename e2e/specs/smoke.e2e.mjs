// The release smoke path (docs/release.md step 5): create a vault, add an
// account, copy its password, lock, unlock, make a backup. One flow; each
// step builds on the one before.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { $, browser, expect } from "@wdio/globals";

const home = process.env.VAULTAIR_E2E_HOME;
const MASTER = "correct horse battery staple e2e";
const ACCOUNT = { name: "Smoke test account", username: "smoke-user", password: `Sm0ke-${Date.now()}-pass` };

/** XPath for an element by its exact visible text. */
function byText(tag, text) {
  return $(`//${tag}[normalize-space()=${JSON.stringify(text)}]`);
}

async function step(title) {
  await byText("h1", title).waitForDisplayed();
}

async function press(text) {
  const button = byText("button", text);
  await button.waitForClickable();
  await button.click();
}

async function toast(text) {
  await $(`(//li[@data-toast-id]//*[normalize-space()=${JSON.stringify(text)}])[1]`).waitForDisplayed();
}

function readClipboard() {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"], {
    encoding: "utf8",
  }).replace(/\r?\n$/, "");
}

async function goTo(route) {
  await browser.execute((hash) => {
    window.location.hash = hash;
  }, `#${route}`);
}

/** The Windows Hello offer appears after an unlock only where Hello is set up. */
async function dismissHelloOffer() {
  const notNow = byText("button", "Not now");
  if (await notNow.isDisplayed()) await notNow.click();
}

describe("Release smoke path", () => {
  let accountRoute;

  it("creates a vault in the default folder", async () => {
    await step("Set up your vault");
    await press("Get started");

    await step("Everything stays on this PC");
    await press("Continue");

    await step("We can't recover your master password");
    await $("#ack-no-recovery").click();
    await press("Continue");

    await step("Name your vault");
    await $("#vault-name").setValue("Smoke test vault");
    await press("Continue");

    await step("Choose where to keep it");
    const dir = $('[data-testid="vault-dir"]');
    await browser.waitUntil(async () => (await dir.getText()).trim() !== "");
    // Proves the app took the scratch LOCALAPPDATA and not the real one.
    expect(path.resolve(await dir.getText()).startsWith(path.resolve(home))).toBe(true);
    await press("Continue");

    await step("Create your master password");
    await $("#new-password").setValue(MASTER);
    await $("#confirm-password").setValue(MASTER);
    await press("Create vault");

    // KDF calibration takes a few seconds; slower on a CI runner.
    await byText("h1", "Your vault is ready").waitForDisplayed({ timeout: 120_000 });
    await press("Skip");

    await step("Plan for backups");
    await press("Open my vault");
    await $('[aria-label="Lock vault"]').waitForDisplayed();
  });

  it("adds an account", async () => {
    await $("a*=Add account").click();
    await $("#acct-title").waitForDisplayed();
    await $("#acct-title").setValue(ACCOUNT.name);
    await $("#acct-username").setValue(ACCOUNT.username);
    await $("#acct-password").setValue(ACCOUNT.password);
    await $(`//button[@type="submit" and normalize-space()="Add account"]`).click();

    await toast("Account added");
    await browser.waitUntil(async () => /^#\/accounts\/[^/]+$/.test(await browser.execute(() => window.location.hash)));
    accountRoute = (await browser.execute(() => window.location.hash)).slice(1);
    await byText("h1", ACCOUNT.name).waitForDisplayed();
  });

  it("copies the password, then clears it", async () => {
    await $('[aria-label="Copy password"]').click();
    await toast("Password copied");
    expect(readClipboard()).toBe(ACCOUNT.password);

    await press("Clear now");
    await browser.waitUntil(() => readClipboard() !== ACCOUNT.password, {
      timeoutMsg: "The clipboard still holds the password after Clear now",
    });
  });

  it("locks", async () => {
    await $('[aria-label="Lock vault"]').click();
    await $("#unlock-password").waitForDisplayed();
    await expect($('[aria-label="Lock vault"]')).not.toBeExisting();
  });

  it("unlocks with the master password, and the account is still there", async () => {
    await $("#unlock-password").setValue(MASTER);
    await press("Unlock");
    await $('[aria-label="Lock vault"]').waitForDisplayed({ timeout: 60_000 });
    await dismissHelloOffer();

    await goTo(accountRoute);
    await byText("h1", ACCOUNT.name).waitForDisplayed();
  });

  it("makes a backup that is saved and checked", async () => {
    const dest = path.join(home, "Backups");
    fs.mkdirSync(dest);
    // The only step not done through the UI: "Choose a folder" opens the native
    // folder picker, which WebDriver can't reach. This is the command it calls.
    await browser.execute(
      (folder) => window.__TAURI_INTERNALS__.invoke("backup_set_destination", { path: folder }),
      dest,
    );

    await goTo("/settings");
    await browser.waitUntil(async () => (await $('[data-testid="backup-folder"]').getText()) === dest);
    expect(await $('[data-testid="last-backup"]').getText()).toBe("None yet");

    await press("Back up now");
    await toast("Backup saved and checked");
    expect(await $('[data-testid="last-backup"]').getText()).not.toBe("None yet");

    const files = fs.readdirSync(dest).filter((f) => f.endsWith(".vaultair-backup"));
    expect(files).toHaveLength(1);
    expect(fs.statSync(path.join(dest, files[0])).size).toBeGreaterThan(0);
  });
});
