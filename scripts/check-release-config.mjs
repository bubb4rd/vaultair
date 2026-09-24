// Fails if the shipped Tauri configuration loosens the security baseline.
// Run in CI. See docs/adr/0001-stack.md and docs/implementation-plan.md §1.3.
import { readFileSync } from "node:fs";

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const security = conf.app?.security ?? {};
const csp = security.csp;

if (typeof csp !== "object" || csp === null) {
  fail("app.security.csp must be set (as an object of directives)");
} else {
  for (const [directive, value] of Object.entries(csp)) {
    if (/'unsafe-eval'|'wasm-unsafe-eval'/.test(value)) fail(`csp ${directive} allows eval`);
    if (/(^|\s)(\*|https?:|data:|blob:)(\s|$)/.test(value) && directive !== "img-src") {
      fail(`csp ${directive} allows a broad source: ${value}`);
    }
  }
  if (/'unsafe-inline'/.test(csp["script-src"] ?? "")) fail("csp script-src allows 'unsafe-inline'");
  if (/'unsafe-inline'/.test(csp["style-src"] ?? "")) fail("csp style-src allows 'unsafe-inline'");
  for (const d of ["default-src", "script-src", "object-src", "base-uri", "frame-ancestors"]) {
    if (!(d in csp)) fail(`csp is missing ${d}`);
  }
  if (csp["object-src"] !== "'none'") fail("csp object-src must be 'none'");
}

if (security.freezePrototype !== true) fail("app.security.freezePrototype must be true");
if (security.dangerousDisableAssetCspModification) fail("dangerousDisableAssetCspModification must be false");
if (security.dangerousRemoteDomainIpcAccess) fail("dangerousRemoteDomainIpcAccess must not be set");
if (conf.app?.withGlobalTauri !== false) fail("app.withGlobalTauri must be false");
if ((conf.app?.windows ?? []).length !== 0) fail("windows are created in Rust (window.rs), not tauri.conf.json");
if (conf.plugins?.updater) fail("no updater in the MVP (ADR-0004)");

const cargo = read("src-tauri/Cargo.toml");
const tauriLine = cargo.split("\n").find((l) => /^tauri\s*=/.test(l)) ?? "";
if (/devtools/.test(tauriLine)) fail("the tauri `devtools` feature must not be enabled");

const capability = JSON.parse(read("src-tauri/capabilities/main.json"));
if (capability.remote) fail("capabilities must not grant remote URLs");
const bannedPrefixes = ["fs:", "shell:", "http:", "opener:", "updater:", "store:", "log:", "clipboard-manager:"];
for (const perm of capability.permissions ?? []) {
  const id = typeof perm === "string" ? perm : perm.identifier;
  if (bannedPrefixes.some((p) => id.startsWith(p))) fail(`capability grants banned permission ${id}`);
  if (id.endsWith(":default") && id !== "core:event:default") fail(`broad default permission ${id}; list what's needed`);
}

if (failures.length) {
  process.stderr.write(`Release config check failed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Release config check passed.\n");
