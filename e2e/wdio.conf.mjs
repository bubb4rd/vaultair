// End-to-end smoke test: drives the release build through tauri-driver and
// msedgedriver (WebView2). The path is docs/release.md step 5. How to run it:
// docs/release.md, "E2E smoke test".
//
// The app runs with LOCALAPPDATA pointed at a scratch folder, so it never sees
// a real vault, config or quick-unlock slot. Vaultair is single-instance: close
// any running copy first, or the test's launch hands off to it and exits.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const app = path.resolve(here, process.env.VAULTAIR_APP ?? "../target/release/vaultair.exe");
const tauriDriver = process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver.exe");
// msedgedriver must match the installed WebView2 runtime exactly.
const edgeDriver = process.env.MSEDGEDRIVER ?? "msedgedriver.exe";

let driver;
let stopping = false;

function stopDriver() {
  stopping = true;
  driver?.kill();
  driver = undefined;
}

// Close-to-tray keeps the app alive after its window goes, so end it by path:
// only the binary under test, never another copy of Vaultair.
function stopApp() {
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process vaultair -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:VAULTAIR_APP_PATH } | Stop-Process -Force",
      ],
      { env: { ...process.env, VAULTAIR_APP_PATH: app }, stdio: "ignore" },
    );
  } catch {
    // Nothing left to stop.
  }
}

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  capabilities: [{ "tauri:options": { application: app } }],
  logLevel: "warn",
  bail: 1,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 0,
  framework: "mocha",
  reporters: ["spec"],
  // One spec, run in order: each step depends on the one before.
  mochaOpts: { ui: "bdd", timeout: 180_000 },

  onPrepare() {
    if (!fs.existsSync(app)) {
      throw new Error(`No app at ${app}. Build it first: npx tauri build --no-bundle`);
    }
    // Workers start after this and inherit the environment.
    const home = process.env.VAULTAIR_E2E_HOME ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultair-e2e-"));
    fs.mkdirSync(home, { recursive: true });
    if (fs.readdirSync(home).length > 0) {
      throw new Error(`${home} is not empty; the smoke test starts from a first run.`);
    }
    process.env.VAULTAIR_E2E_HOME = home;
    console.log(`Scratch LOCALAPPDATA: ${home}`);
  },

  beforeSession() {
    stopping = false;
    driver = spawn(tauriDriver, ["--native-driver", edgeDriver], {
      env: { ...process.env, LOCALAPPDATA: process.env.VAULTAIR_E2E_HOME },
      stdio: ["ignore", "inherit", "inherit"],
    });
    driver.on("error", (err) => {
      console.error("tauri-driver failed to start:", err);
      process.exit(1);
    });
    driver.on("exit", (code) => {
      if (!stopping) {
        console.error(`tauri-driver exited with code ${code}`);
        process.exit(1);
      }
    });
  },

  afterSession() {
    stopDriver();
    stopApp();
  },
};

for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    stopDriver();
    if (signal !== "exit") process.exit(1);
  });
}
