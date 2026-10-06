import { describe, expect, it } from "vitest";
import { logoFor, resolveMark } from "./logos";
import { SIMPLE_ICONS, type LogoRecord } from "./logos.generated";

// The manifest itself is validated in scripts/logos.test.mjs.
describe("resolving a mark", () => {
  const manifest: Record<string, LogoRecord> = {
    "builtin-game-valorant": { kind: "simple-icons", slug: "valorant" },
    "builtin-pl-steam": { kind: "simple-icons", slug: "steam", color: "66C0F4" },
    "builtin-pl-xbox": { kind: "monogram", color: "107C10" },
    "builtin-game-wow": { kind: "monogram" },
    "builtin-game-good": { kind: "file", src: "/assets/good.svg" },
  };
  const mark = (id: string | null, icon: string | null) => resolveMark(manifest, SIMPLE_ICONS, id, icon);

  it("goes by the catalog id before the stored slug", () => {
    expect(mark("builtin-game-valorant", "discord")).toMatchObject({ kind: "path", slug: "valorant", hex: "FA4454" });
    // A vault seeded before the logo existed has no slug at all.
    expect(mark("builtin-game-valorant", null)).toMatchObject({ kind: "path", slug: "valorant" });
    // A deliberate monogram isn't overridden by an old slug either.
    expect(mark("builtin-pl-xbox", "discord")).toEqual({ kind: "monogram", color: "107C10" });
  });

  it("still resolves the stored slug for rows the manifest doesn't cover", () => {
    expect(mark("a-user-added-platform", "discord")).toMatchObject({ kind: "path", slug: "discord", hex: "5865F2" });
    expect(mark(null, "discord")).toMatchObject({ kind: "path", slug: "discord" });
  });

  it("falls back to a neutral monogram", () => {
    expect(mark("a-user-added-platform", "not-a-slug")).toEqual({ kind: "monogram", color: null });
    expect(mark(null, null)).toEqual({ kind: "monogram", color: null });
    // Ids and slugs come from the vault: an inherited property isn't a record.
    expect(mark("constructor", "toString")).toEqual({ kind: "monogram", color: null });
  });

  it("carries a monogram's colour, a file's source and a colour override", () => {
    expect(mark("builtin-pl-xbox", null)).toEqual({ kind: "monogram", color: "107C10" });
    expect(mark("builtin-game-wow", null)).toEqual({ kind: "monogram", color: null });
    expect(mark("builtin-game-good", null)).toEqual({ kind: "file", src: "/assets/good.svg" });
    expect(mark("builtin-pl-steam", null)).toMatchObject({ kind: "path", slug: "steam", hex: "66C0F4" });
  });

  it("reads the bundled manifest", () => {
    expect(logoFor("builtin-game-valorant", null)).toMatchObject({ kind: "path", slug: "valorant" });
    expect(logoFor("builtin-pl-xbox", null)).toEqual({ kind: "monogram", color: "107C10" });
  });
});
