// The logo pipeline: report, suggest, sheet, build. Developer-side only and
// offline: it reads the pinned simple-icons package and files in the repo,
// never the network. A person approves every mark; this only checks and
// generates. See docs/logo-pipeline.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = "crates/vaultair-core/catalog/default_catalog.json";
const MANIFEST = "crates/vaultair-core/catalog/logos.json";
const GENERATED = "src/features/catalog/logos.generated.ts";
const LOGO_DIR = "src/assets/logos";
const SIMPLE_ICONS = "node_modules/simple-icons";
const SHEET = ".asset-work/sheet.html";

const SVG_MAX_BYTES = 16 * 1024;
const PNG_MAX_BYTES = 32 * 1024;
const PNG_SIZES = [128, 256];
const STALE_MONTHS = 6;

/** Fields by kind. Records are written with their keys in KEY_ORDER. */
const FIELDS = {
  "simple-icons": { required: ["slug"], optional: ["color"] },
  file: { required: ["path", "source", "licence", "reviewedBy", "reviewedAt", "sha256"], optional: ["color"] },
  monogram: { required: ["reason", "checkedAt"], optional: ["color"] },
};
const KEY_ORDER = [
  "kind",
  "slug",
  "path",
  "color",
  "source",
  "licence",
  "reason",
  "checkedAt",
  "reviewedBy",
  "reviewedAt",
  "sha256",
];
/** What the owner fills in at review, and what `build` fills in. Missing, they don't stop a build. */
const SIGN_OFF = ["reviewedBy", "reviewedAt"];
const BUILD_TOLERATES = ["file-unsigned", "file-unhashed"];

const HEX = /^[0-9A-Fa-f]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The catalog, the manifest and the pinned Simple Icons data, from disk. */
export function loadInputs(root = ROOT) {
  const catalog = readJson(path.join(root, CATALOG));
  const manifestFile = path.join(root, MANIFEST);
  const data = readJson(path.join(root, SIMPLE_ICONS, "data/simple-icons.json"));
  return {
    entries: [...catalog.platforms, ...catalog.games].map(({ id, name, icon }) => ({ id, name, icon: icon ?? null })),
    manifest: existsSync(manifestFile) ? readJson(manifestFile) : {},
    icons: new Map(data.map((icon) => [icon.slug, icon])),
    logoDir: path.join(root, LOGO_DIR),
  };
}

/** Where an approved file for this catalog ID lives, without its extension: `games/overwatch2`. */
function fileStem(id) {
  if (id.startsWith("builtin-pl-")) return `platforms/${id.slice("builtin-pl-".length)}`;
  if (id.startsWith("builtin-game-")) return `games/${id.slice("builtin-game-".length)}`;
  return null;
}

/** What's wrong with an SVG as a bundled logo. Rejects; never cleans. */
export function checkSvg(bytes) {
  const problems = [];
  const text = bytes.toString("utf8");
  if (bytes.length >= SVG_MAX_BYTES) problems.push(`is ${bytes.length} bytes; an SVG must be under 16 KB`);
  if (/<!DOCTYPE/i.test(text)) problems.push("has a <!DOCTYPE>");
  if (/<!ENTITY/i.test(text)) problems.push("declares an <!ENTITY>");
  for (const tag of ["script", "foreignObject", "image"]) {
    if (new RegExp(`<${tag}[\\s>/]`, "i").test(text)) problems.push(`contains <${tag}>`);
  }
  for (const [, css] of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/@import|url\(/i.test(css)) problems.push("has a <style> with @import or url(");
  }
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) problems.push("has an on* event attribute");
  for (const [, double, single, bare] of text.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const target = (double ?? single ?? bare ?? "").trim();
    if (!target.startsWith("#")) problems.push(`has an href that leaves the file (${target || "empty"})`);
  }
  const viewBox = /<svg\b[^>]*\bviewBox\s*=\s*["']([^"']*)["']/i.exec(text)?.[1];
  const box = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (box.length !== 4 || box.some(Number.isNaN)) {
    problems.push("has no viewBox on its <svg>");
  } else {
    const ratio = box[2] / box[3];
    if (!(ratio >= 0.8 && ratio <= 1.25)) problems.push(`is ${box[2]} by ${box[3]}; a mark must be square or nearly so`);
  }
  return problems;
}

/** What's wrong with a PNG as a bundled logo. */
export function checkPng(bytes) {
  const problems = [];
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return ["is not a PNG"];
  if (bytes.length >= PNG_MAX_BYTES) problems.push(`is ${bytes.length} bytes; a PNG must be under 32 KB`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== height || !PNG_SIZES.includes(width)) {
    problems.push(`is ${width} by ${height}; a PNG must be 128 or 256 px square`);
  }
  return problems;
}

/**
 * Everything wrong with the manifest, as `{ id, code, message }`. An empty
 * list means every built-in entity has one valid record and every file is
 * the one that was reviewed.
 */
export function checkManifest({ entries, manifest, icons, logoDir }) {
  const problems = [];
  const fail = (id, code, message) => problems.push({ id, code, message });
  const known = new Set(entries.map((e) => e.id));

  for (const entry of entries) {
    if (!Object.hasOwn(manifest, entry.id)) fail(entry.id, "missing-record", "has no record in logos.json");
    if (entry.icon && !icons.has(entry.icon)) {
      fail(entry.id, "unknown-slug", `names the icon "${entry.icon}", which the pinned simple-icons doesn't have`);
    }
  }

  for (const [id, record] of Object.entries(manifest)) {
    if (!known.has(id)) fail(id, "unknown-id", "isn't a built-in ID in default_catalog.json");
    const fields = record && typeof record === "object" ? FIELDS[record.kind] : undefined;
    if (!fields) {
      fail(id, "bad-record", `has the kind ${JSON.stringify(record?.kind)}; use simple-icons, file or monogram`);
      continue;
    }
    for (const key of Object.keys(record)) {
      if (key !== "kind" && !fields.required.includes(key) && !fields.optional.includes(key)) {
        fail(id, "bad-record", `has the field "${key}", which a ${record.kind} record doesn't take`);
      } else if (typeof record[key] !== "string" || record[key].trim() === "") {
        fail(id, "bad-record", `has an empty or non-text "${key}"`);
      }
    }
    for (const key of fields.required) {
      if (key in record) continue;
      if (SIGN_OFF.includes(key)) fail(id, "file-unsigned", `isn't signed: the owner sets "${key}" after reviewing the file`);
      else if (key === "sha256") fail(id, "file-unhashed", 'has no "sha256"; run npm run logos:build');
      else fail(id, "bad-record", `is missing "${key}"`);
    }
    if (typeof record.color === "string" && !HEX.test(record.color)) {
      fail(id, "bad-record", `has the colour "${record.color}"; use six hex digits without #`);
    }
    for (const key of ["checkedAt", "reviewedAt"]) {
      if (typeof record[key] === "string" && !DATE.test(record[key])) {
        fail(id, "bad-record", `has the ${key} "${record[key]}"; use YYYY-MM-DD`);
      }
    }
    if (record.kind === "simple-icons" && typeof record.slug === "string" && !icons.has(record.slug)) {
      fail(id, "unknown-slug", `names the slug "${record.slug}", which the pinned simple-icons doesn't have`);
    }
    if (record.kind !== "file" || typeof record.path !== "string") continue;

    // A file is named after its ID, so no two records can share one.
    const stem = fileStem(id);
    const extension = path.posix.extname(record.path).toLowerCase();
    if (![".svg", ".png"].includes(extension)) {
      fail(id, "file-invalid", `points at ${record.path}; only SVG and PNG are allowed`);
      continue;
    }
    if (stem && record.path !== `${stem}${extension}`) {
      fail(id, "file-outside", `points at ${record.path}; its file is ${stem}${extension} under ${LOGO_DIR}/`);
      continue;
    }
    const file = path.join(logoDir, record.path);
    if (!existsSync(file)) {
      fail(id, "file-missing", `points at ${record.path}, which doesn't exist under ${LOGO_DIR}/`);
      continue;
    }
    const bytes = readFileSync(file);
    for (const problem of extension === ".svg" ? checkSvg(bytes) : checkPng(bytes)) {
      fail(id, "file-invalid", `${record.path} ${problem}`);
    }
    if (typeof record.sha256 === "string" && record.sha256 !== sha256(bytes)) {
      const hint = SHA256.test(record.sha256) ? "the file changed after review" : "the hash is malformed";
      fail(id, "file-mismatch", `${record.path} doesn't match its sha256 (${hint}); it needs a new review`);
    }
  }
  return problems;
}

/** Monogram records nobody has rechecked for six months. Informational. */
export function staleMonograms(manifest, today = new Date()) {
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  const limit = cutoff.toISOString().slice(0, 10);
  return Object.entries(manifest)
    .filter(([, r]) => r?.kind === "monogram" && typeof r.checkedAt === "string" && r.checkedAt < limit)
    .map(([id, r]) => ({ id, checkedAt: r.checkedAt }));
}

/** The manifest as it's committed: IDs sorted, keys in one order, two-space indent, trailing newline. */
export function canonical(manifest) {
  const sorted = {};
  for (const id of Object.keys(manifest).sort(byId)) {
    const record = manifest[id];
    sorted[id] = {};
    for (const key of [...KEY_ORDER, ...Object.keys(record).sort(byId)]) {
      if (key in record && !(key in sorted[id])) sorted[id][key] = record[key];
    }
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** `siValorant` for "valorant", as simple-icons exports it. */
const iconExport = (slug) => `si${slug[0].toUpperCase()}${slug.slice(1)}`;

/** `fileGamesOverwatch2` for "games/overwatch2.svg". */
function fileExport(file) {
  const words = file.replace(/\.[^.]+$/, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return `file${words.map((w) => `${w[0].toUpperCase()}${w.slice(1)}`).join("")}`;
}

/** The source of `logos.generated.ts`. The same inputs always give the same text. */
export function generate({ entries, manifest }) {
  const ids = Object.keys(manifest).sort(byId);
  const records = ids.map((id) => [id, manifest[id]]);
  const slugs = new Set(entries.map((e) => e.icon).filter(Boolean));
  for (const [, record] of records) if (record.kind === "simple-icons") slugs.add(record.slug);
  const sortedSlugs = [...slugs].sort(byId);
  const files = records.filter(([, r]) => r.kind === "file").map(([, r]) => r.path);

  const literal = (record) => {
    const color = record.color ? `, color: ${JSON.stringify(record.color)}` : "";
    if (record.kind === "simple-icons") return `{ kind: "simple-icons", slug: ${JSON.stringify(record.slug)}${color} }`;
    if (record.kind === "file") return `{ kind: "file", src: ${fileExport(record.path)}${color} }`;
    return `{ kind: "monogram"${color} }`;
  };

  return [
    "// Generated by `npm run logos:build` from crates/vaultair-core/catalog/logos.json",
    "// and default_catalog.json. Don't edit by hand; see docs/logo-pipeline.md.",
    'import type { SimpleIcon } from "simple-icons";',
    "import {",
    ...sortedSlugs.map((slug) => `  ${iconExport(slug)},`),
    '} from "simple-icons";',
    ...files.map((file) => `import ${fileExport(file)} from "@/assets/logos/${file}";`),
    "",
    "export type LogoRecord =",
    '  | { kind: "simple-icons"; slug: string; color?: string }',
    '  | { kind: "file"; src: string; color?: string }',
    '  | { kind: "monogram"; color?: string };',
    "",
    "/** Simple Icons marks by slug: the ones the manifest names and the catalog's legacy `icon` slugs. */",
    "export const SIMPLE_ICONS: Record<string, SimpleIcon> = {",
    ...sortedSlugs.map((slug) => `  ${JSON.stringify(slug)}: ${iconExport(slug)},`),
    "};",
    "",
    "/** One record per built-in catalog ID. */",
    "export const MANIFEST: Record<string, LogoRecord> = {",
    ...records.map(([id, record]) => `  ${JSON.stringify(id)}: ${literal(record)},`),
    "};",
    "",
  ].join("\n");
}

const printProblems = (problems) => problems.map((p) => `  - ${p.id} ${p.message}`).join("\n");

function report() {
  const inputs = loadInputs();
  const problems = checkManifest(inputs);
  const stale = staleMonograms(inputs.manifest);
  const counts = {};
  for (const record of Object.values(inputs.manifest)) counts[record?.kind] = (counts[record?.kind] ?? 0) + 1;
  const kinds = Object.keys(FIELDS).map((kind) => `${counts[kind] ?? 0} ${kind}`);
  process.stdout.write(`${inputs.entries.length} built-in entities: ${kinds.join(", ")}.\n`);
  if (stale.length) {
    const lines = stale.map((s) => `  - ${s.id} last checked ${s.checkedAt}`).join("\n");
    process.stdout.write(`Monograms not rechecked for ${STALE_MONTHS} months (worth another look):\n${lines}\n`);
  }
  if (problems.length) {
    process.stderr.write(`Logo report failed:\n${printProblems(problems)}\n`);
    process.exit(1);
  }
  process.stdout.write("Logo report passed: every built-in ID is accounted for.\n");
}

/** Lowercase letters and digits only, so "Battle.net" and "battle net" compare equal. */
const normalise = (text) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every name Simple Icons knows an icon by. */
function iconNames(icon) {
  const aliases = icon.aliases ?? {};
  return [
    icon.title,
    icon.slug,
    ...(aliases.aka ?? []),
    ...(aliases.dup ?? []).map((d) => d.title),
    ...Object.values(aliases.loc ?? {}),
  ];
}

function suggest() {
  const { entries, manifest, icons } = loadInputs();
  const open = entries.filter((e) => !Object.hasOwn(manifest, e.id) || manifest[e.id]?.kind === "monogram");
  let found = 0;
  for (const entry of open) {
    const wanted = normalise(entry.name);
    const matches = [...icons.values()].filter((icon) => iconNames(icon).some((n) => normalise(n) === wanted));
    for (const icon of matches) {
      found += 1;
      const terms = [
        icon.guidelines ? `guidelines: ${icon.guidelines}` : null,
        icon.license ? `licence: ${icon.license.type}${icon.license.url ? ` ${icon.license.url}` : ""}` : null,
      ].filter(Boolean);
      process.stdout.write(`${entry.id} (${entry.name}): simple-icons "${icon.slug}" (${icon.title})\n`);
      process.stdout.write(`  ${terms.length ? terms.join("; ") : "no guidelines or licence listed"}\n`);
    }
  }
  process.stdout.write(
    `${found} candidate${found === 1 ? "" : "s"} for ${open.length} entities without a logo. ` +
      "A candidate is a lead, not an approval: read the brand's terms before changing a record.\n",
  );
}

// The sheet draws marks the way the app does, so these mirror
// src/features/catalog/logos.ts and src/styles/globals.css.
const CARD = "17181c";
const FOREGROUND = "edeef0";

function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const readsOnCard = (hex) => (luminance(hex) + 0.05) / (luminance(CARD) + 0.05) >= 3;

function monogram(name) {
  const words = name
    .split(/[\s._\-:]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function sheet() {
  const { entries, manifest, icons, logoDir } = loadInputs();
  const iconPath = (slug) => {
    const svg = readFileSync(path.join(ROOT, SIMPLE_ICONS, "icons", `${slug}.svg`), "utf8");
    return /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";
  };

  /** One mark at one size, on the dark card or on white. */
  const draw = (entry, record, size, dark) => {
    if (record?.kind === "simple-icons" && icons.has(record.slug)) {
      const hex = record.color ?? icons.get(record.slug).hex;
      const fill = dark ? (readsOnCard(hex) ? hex : FOREGROUND) : hex;
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#${fill}"><path d="${iconPath(record.slug)}"/></svg>`;
    }
    if (record?.kind === "file" && existsSync(path.join(logoDir, record.path))) {
      const mime = record.path.toLowerCase().endsWith(".png") ? "image/png" : "image/svg+xml";
      const data = readFileSync(path.join(logoDir, record.path)).toString("base64");
      return `<img alt="" width="${size}" height="${size}" src="data:${mime};base64,${data}">`;
    }
    const surface = dark ? `#${CARD}` : "#ffffff";
    const color = record?.kind === "monogram" && HEX.test(record.color ?? "") ? record.color : null;
    const text = dark ? (color && readsOnCard(color) ? `#${color}` : `#${color ? FOREGROUND : "9aa0aa"}`) : `#${color ?? "555555"}`;
    const fill = color ? `color-mix(in oklab, #${color} 15%, ${surface})` : surface;
    const edge = color ? `color-mix(in oklab, #${color} 45%, ${surface})` : dark ? "#33363c" : "#cccccc";
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;color:${text};background:${fill};border-color:${edge}`;
    return `<span class="tile" style="${style}">${escapeHtml(monogram(entry.name))}</span>`;
  };

  const notes = (record) => {
    if (!record) return ["no record", "", ""];
    if (record.kind === "simple-icons") {
      const icon = icons.get(record.slug);
      const terms = icon?.guidelines ? `CC0 (Simple Icons); guidelines: ${icon.guidelines}` : "CC0 (Simple Icons)";
      return [`simple-icons: ${record.slug}`, icon?.source ?? "", terms];
    }
    if (record.kind === "file") {
      const signed = record.reviewedBy ? `reviewed by ${record.reviewedBy}, ${record.reviewedAt ?? "no date"}` : "NOT SIGNED";
      return [`file: ${record.path} (${signed})`, record.source ?? "", record.licence ?? ""];
    }
    return [`monogram${record.color ? ` #${record.color}` : ""}`, `checked ${record.checkedAt ?? "never"}`, record.reason ?? ""];
  };

  const rows = entries.map((entry) => {
    const record = manifest[entry.id];
    const strip = (dark) =>
      `<td class="${dark ? "dark" : "light"}">${[24, 48, 128].map((size) => draw(entry, record, size, dark)).join("")}</td>`;
    const [kind, source, licence] = notes(record).map(escapeHtml);
    return `<tr><th scope="row">${escapeHtml(entry.name)}<br><code>${escapeHtml(entry.id)}</code></th>${strip(true)}${strip(false)}<td>${kind}</td><td>${source}</td><td>${licence}</td></tr>`;
  });

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Vaultair logo sheet</title>
<style>
  body { margin: 24px; font: 13px/1.4 system-ui, sans-serif; color: #222; background: #f4f4f5; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { padding: 12px; border: 1px solid #ddd; text-align: left; vertical-align: middle; }
  thead th { font-size: 12px; background: #fafafa; }
  code { font-size: 11px; color: #666; }
  td.dark { background: #${CARD}; }
  td.dark, td.light { white-space: nowrap; }
  td.dark > *, td.light > * { margin-right: 16px; vertical-align: middle; }
  .tile { display: inline-grid; place-items: center; box-sizing: border-box; border: 1px solid; border-radius: 18%; font-weight: 600; }
</style>
<h1>Logo sheet</h1>
<p>Every built-in mark at 24, 48 and 128 px, on the app's card surface and on white. A mark has to read at 24 px on the dark surface. Generated by <code>npm run logos:sheet</code>; not committed.</p>
<table>
<thead><tr><th>Entity</th><th>On the card</th><th>On white</th><th>Record</th><th>Source</th><th>Licence or reason</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</html>
`;
  mkdirSync(path.dirname(path.join(ROOT, SHEET)), { recursive: true });
  writeFileSync(path.join(ROOT, SHEET), html);
  process.stdout.write(`Wrote ${SHEET} (${entries.length} entities). Open it in a browser.\n`);
}

function build() {
  const inputs = loadInputs();
  const blocking = checkManifest(inputs).filter((p) => !BUILD_TOLERATES.includes(p.code));
  if (blocking.length) {
    process.stderr.write(`Logo build failed; nothing was written:\n${printProblems(blocking)}\n`);
    process.exit(1);
  }
  for (const record of Object.values(inputs.manifest)) {
    // Only ever fills an empty hash: a file that changed after review fails above instead.
    if (record.kind === "file" && !record.sha256) record.sha256 = sha256(readFileSync(path.join(inputs.logoDir, record.path)));
  }
  writeFileSync(path.join(ROOT, MANIFEST), canonical(inputs.manifest));
  writeFileSync(path.join(ROOT, GENERATED), generate(inputs));
  process.stdout.write(`Wrote ${MANIFEST} and ${GENERATED} (${Object.keys(inputs.manifest).length} records).\n`);
}

const COMMANDS = { report, suggest, sheet, build };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = COMMANDS[process.argv[2]];
  if (!command) {
    process.stderr.write(`Usage: node scripts/logos.mjs <${Object.keys(COMMANDS).join("|")}>\n`);
    process.exit(1);
  }
  command();
}
