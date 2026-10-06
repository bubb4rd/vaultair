// Validation for the logo manifest and the files it names. See docs/logo-pipeline.md.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonical, checkManifest, checkPng, checkSvg, generate, loadInputs, staleMonograms } from "./logos.mjs";

const repo = (file) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", file);
/** Stand-ins for approved files. Real ones live in src/assets/logos/ and are signed by the owner. */
const FIXTURES = repo("src/test/fixtures/logos");
const real = loadInputs();

describe("the logo manifest", () => {
  it("has one valid record for every built-in entity, and only for those", () => {
    expect(real.entries.length).toBeGreaterThan(50);
    expect(checkManifest(real)).toEqual([]);
  });

  it("is committed in canonical form, with the generated module current", () => {
    // `npm run logos:build` rewrites both.
    expect(readFileSync(repo("crates/vaultair-core/catalog/logos.json"), "utf8")).toBe(canonical(real.manifest));
    expect(readFileSync(repo("src/features/catalog/logos.generated.ts"), "utf8")).toBe(generate(real));
  });
});

const STEAM = { kind: "simple-icons", slug: "steam" };
const MONOGRAM = { kind: "monogram", reason: "No licence on record.", checkedAt: "2026-10-06" };
const COMPLETE = { "builtin-pl-steam": STEAM, "builtin-game-good": MONOGRAM, "builtin-game-bad": MONOGRAM };

/** A three-entry catalog whose files are the fixtures. */
const small = {
  entries: [
    { id: "builtin-pl-steam", name: "Steam", icon: "steam" },
    { id: "builtin-game-good", name: "Good", icon: null },
    { id: "builtin-game-bad", name: "Bad", icon: null },
  ],
  manifest: COMPLETE,
  icons: real.icons,
  logoDir: FIXTURES,
};

const problems = (manifest) => checkManifest({ ...small, manifest });
const codes = (manifest) => problems(manifest).map((p) => `${p.id}: ${p.code}`);

const fileRecord = (file) => ({
  kind: "file",
  path: file,
  source: "https://example.com/press",
  licence: "Press kit terms allow showing the logo to identify the service.",
  sha256: createHash("sha256")
    .update(readFileSync(`${FIXTURES}/${file}`))
    .digest("hex"),
});
const SIGNED = { reviewedBy: "owner", reviewedAt: "2026-10-06" };

describe("manifest validation", () => {
  it("accepts a complete manifest", () => {
    expect(problems(COMPLETE)).toEqual([]);
  });

  it("reports a built-in with no record and a record for an ID that doesn't exist", () => {
    const manifest = { "builtin-pl-steam": STEAM, "builtin-game-good": MONOGRAM, "builtin-game-gone": MONOGRAM };
    expect(codes(manifest)).toEqual(["builtin-game-bad: missing-record", "builtin-game-gone: unknown-id"]);
  });

  it.each([
    ["an unknown kind", { kind: "favicon" }, "bad-record"],
    ["a field its kind doesn't take", { ...STEAM, licence: "CC0" }, "bad-record"],
    ["a colour with a #", { ...STEAM, color: "#66C0F4" }, "bad-record"],
    ["a monogram with no date", { kind: "monogram", reason: "No licence." }, "bad-record"],
    ["a date in another format", { ...MONOGRAM, checkedAt: "06/10/2026" }, "bad-record"],
    ["an empty reason", { ...MONOGRAM, reason: " " }, "bad-record"],
    ["a slug Simple Icons doesn't have", { kind: "simple-icons", slug: "not-a-real-brand" }, "unknown-slug"],
  ])("rejects %s", (_name, record, code) => {
    expect(codes({ ...COMPLETE, "builtin-pl-steam": record })).toEqual([`builtin-pl-steam: ${code}`]);
  });

  it("accepts a file the owner has signed", () => {
    expect(problems({ ...COMPLETE, "builtin-game-good": { ...fileRecord("games/good.svg"), ...SIGNED } })).toEqual([]);
  });

  it("fails a file record until the owner signs it", () => {
    const found = problems({ ...COMPLETE, "builtin-game-good": fileRecord("games/good.svg") });
    expect(found.map((p) => p.code)).toEqual(["file-unsigned", "file-unsigned"]);
    expect(found[0].message).toBe('isn\'t signed: the owner sets "reviewedBy" after reviewing the file');
  });

  it("fails a bad SVG and says what's wrong with it", () => {
    const found = problems({ ...COMPLETE, "builtin-game-bad": { ...fileRecord("games/bad.svg"), ...SIGNED } });
    expect(found.map((p) => `${p.code}: ${p.message}`)).toEqual([
      "file-invalid: games/bad.svg contains <script>",
      "file-invalid: games/bad.svg has an on* event attribute",
    ]);
  });

  it("fails a file that changed after its review", () => {
    const record = { ...fileRecord("games/good.svg"), ...SIGNED, sha256: "0".repeat(64) };
    expect(problems({ ...COMPLETE, "builtin-game-good": record })).toEqual([
      {
        id: "builtin-game-good",
        code: "file-mismatch",
        message: "games/good.svg doesn't match its sha256 (the file changed after review); it needs a new review",
      },
    ]);
  });

  it.each([
    ["a file that isn't there", "games/good.png", "file-missing"],
    ["another entity's file", "games/bad.svg", "file-outside"],
    ["a path out of the logo folder", "../games/good.svg", "file-outside"],
    ["a format that isn't SVG or PNG", "games/good.jpg", "file-invalid"],
  ])("rejects %s", (_name, file, code) => {
    const record = { ...fileRecord("games/good.svg"), ...SIGNED, path: file };
    expect(codes({ ...COMPLETE, "builtin-game-good": record })).toEqual([`builtin-game-good: ${code}`]);
  });

  it("lists monograms nobody has rechecked for six months", () => {
    const manifest = { old: { ...MONOGRAM, checkedAt: "2026-04-05" }, recent: { ...MONOGRAM, checkedAt: "2026-04-06" } };
    expect(staleMonograms(manifest, new Date("2026-10-06T12:00:00Z"))).toEqual([{ id: "old", checkedAt: "2026-04-05" }]);
  });
});

describe("file rules", () => {
  const svg = (body, attributes = 'viewBox="0 0 24 24"') =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`);

  it("accepts a plain square mark, gradients and all", () => {
    const body = '<defs><linearGradient id="g"/></defs><use href="#g"/><path fill="url(#g)" d="M4 4h16v16H4z"/>';
    expect(checkSvg(svg(body))).toEqual([]);
    expect(checkSvg(svg("", 'viewBox="0 0 20 24"'))).toEqual([]);
  });

  it.each([
    ["a script", svg("<script>alert(1)</script>"), "contains <script>"],
    ["a foreignObject", svg("<foreignObject><p>hi</p></foreignObject>"), "contains <foreignObject>"],
    ["an embedded image", svg('<image href="#a"/>'), "contains <image>"],
    ["a stylesheet import", svg("<style>@import 'theme.css';</style>"), "has a <style> with @import or url("],
    ["an event handler", svg('<path onclick="go()" d="M0 0"/>'), "has an on* event attribute"],
    [
      "a link out of the file",
      svg('<use href="https://example.com/a.svg#b"/>'),
      "has an href that leaves the file (https://example.com/a.svg#b)",
    ],
    [
      "an xlink out of the file",
      svg('<use xlink:href="data:image/png;base64,AA"/>'),
      "has an href that leaves the file (data:image/png;base64,AA)",
    ],
    ["a doctype", Buffer.from('<!DOCTYPE svg><svg viewBox="0 0 24 24"/>'), "has a <!DOCTYPE>"],
    ["an entity", Buffer.from('<!ENTITY a "b"><svg viewBox="0 0 24 24"/>'), "declares an <!ENTITY>"],
    ["no viewBox", svg("", 'width="24" height="24"'), "has no viewBox on its <svg>"],
    ["a wide mark", svg("", 'viewBox="0 0 48 24"'), "is 48 by 24; a mark must be square or nearly so"],
  ])("rejects an SVG with %s", (_name, bytes, message) => {
    expect(checkSvg(bytes)).toEqual([message]);
  });

  it("rejects an SVG of 16 KB or more", () => {
    expect(checkSvg(svg(`<path d="${"M0 0".repeat(4096)}"/>`))).toEqual([expect.stringMatching(/an SVG must be under 16 KB$/)]);
  });

  /** A PNG's signature and header, padded to a size. */
  function png(width, height, bytes = 64) {
    const buffer = Buffer.alloc(bytes);
    Buffer.from("89504e470d0a1a0a", "hex").copy(buffer);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  }

  it("takes a PNG only at 128 or 256 px square and under 32 KB", () => {
    expect(checkPng(png(128, 128))).toEqual([]);
    expect(checkPng(png(256, 256))).toEqual([]);
    expect(checkPng(png(256, 128))).toEqual(["is 256 by 128; a PNG must be 128 or 256 px square"]);
    expect(checkPng(png(512, 512))).toEqual(["is 512 by 512; a PNG must be 128 or 256 px square"]);
    expect(checkPng(png(128, 128, 32 * 1024))).toEqual(["is 32768 bytes; a PNG must be under 32 KB"]);
    expect(checkPng(Buffer.from("GIF89a, and then some bytes to pad it out"))).toEqual(["is not a PNG"]);
  });
});
