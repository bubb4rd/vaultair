// Fails if the manifests disagree on the app version, or if the tag being released
// doesn't match it. Run in CI, and by the release workflow with the tag. See docs/release.md.
//
//   node scripts/check-release-version.mjs          the manifests agree with each other
//   node scripts/check-release-version.mjs v0.1.1   ...and the tag is that version
import { readFileSync } from "node:fs";

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

/** The `version = "..."` line of one TOML table, or of one `[[package]]` entry in Cargo.lock. */
const tomlVersion = (text, header) => {
  const start = text.indexOf(header);
  if (start === -1) return undefined;
  const body = text.slice(start + header.length).split(/^\[/m)[0];
  return /^version\s*=\s*"([^"]+)"/m.exec(body)?.[1];
};

const lock = read("Cargo.lock");
const npmLock = JSON.parse(read("package-lock.json"));
const versions = {
  "Cargo.toml [workspace.package]": tomlVersion(read("Cargo.toml"), "[workspace.package]"),
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "package.json": JSON.parse(read("package.json")).version,
  "package-lock.json": npmLock.version,
  "package-lock.json (root package)": npmLock.packages?.[""]?.version,
};
for (const crate of ["vaultair", "vaultair-core", "vaultair-platform"]) {
  versions[`Cargo.lock (${crate})`] = tomlVersion(lock, `name = "${crate}"\n`);
}

const expected = versions["Cargo.toml [workspace.package]"];
if (!/^\d+\.\d+\.\d+$/.test(expected ?? "")) {
  fail(`Cargo.toml [workspace.package] version must be MAJOR.MINOR.PATCH (found ${expected ?? "none"})`);
}
for (const [where, version] of Object.entries(versions)) {
  if (version !== expected) fail(`${where} is ${version ?? "missing"}, expected ${expected}`);
}

const tag = process.argv[2];
if (tag !== undefined && tag !== `v${expected}`) {
  fail(`tag ${tag} does not match the app version; expected v${expected}`);
}

if (failures.length) {
  process.stderr.write(`Release version check failed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Release version check passed: ${expected}${tag ? ` (tag ${tag})` : ""}.\n`);
