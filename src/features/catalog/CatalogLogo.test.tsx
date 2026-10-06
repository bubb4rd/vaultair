import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { CatalogLogo } from "./CatalogLogo";

// A reviewed file, which the real manifest doesn't have yet.
vi.mock("./logos.generated", async (importOriginal) => {
  const real = await importOriginal<typeof import("./logos.generated")>();
  return { ...real, MANIFEST: { ...real.MANIFEST, "builtin-game-good": { kind: "file", src: "/assets/good.svg" } } };
});

function mark(ui: ReactElement) {
  const el = render(ui).container.querySelector<HTMLElement>("[data-logo]");
  if (!el) throw new Error("no mark rendered");
  return el;
}

describe("CatalogLogo", () => {
  it("draws a Simple Icons mark inline, found by the catalog id", () => {
    const el = mark(<CatalogLogo id="builtin-game-valorant" icon={null} name="Valorant" />);
    expect(el).toHaveAttribute("data-logo", "valorant");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.querySelector("svg path")).toHaveAttribute("d");
  });

  it("shows a reviewed file as an image, never as inline markup", () => {
    const el = mark(<CatalogLogo id="builtin-game-good" icon={null} name="Good" />);
    expect(el).toHaveAttribute("data-logo", "file:builtin-game-good");
    expect(el).toHaveAttribute("aria-hidden", "true");
    const img = el.querySelector("img");
    expect(img).toHaveAttribute("src", "/assets/good.svg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("draggable", "false");
    expect(el.querySelector("svg")).toBeNull();
  });

  it("tints a built-in's monogram with its brand colour and keeps it decorative", () => {
    const el = mark(<CatalogLogo id="builtin-pl-xbox" icon={null} name="Xbox" />);
    expect(el).toHaveAttribute("data-logo", "monogram");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveTextContent("X");
    expect(el.style.getPropertyValue("--logo-tint")).toBe("#107C10");
    // Xbox green reads on the card, so the initials take it.
    expect(el.style.color).toBe("rgb(16, 124, 16)");
  });

  it("keeps the initials in the text colour when the brand colour is too dark", () => {
    const el = mark(<CatalogLogo id="builtin-pl-yahoo" icon={null} name="Yahoo Mail" />);
    expect(el.style.getPropertyValue("--logo-tint")).toBe("#6001D2");
    expect(el.style.color).toBe("");
    expect(el.className).toMatch(/(^| )text-foreground( |$)/);
  });

  it("leaves a user-added entry's tile neutral", () => {
    const el = mark(<CatalogLogo id="p-user-added" icon={null} name="Old launcher" />);
    expect(el).toHaveAttribute("data-logo", "monogram");
    expect(el).toHaveTextContent("OL");
    expect(el.style.getPropertyValue("--logo-tint")).toBe("");
    expect(el.className).toMatch(/(^| )bg-card( |$)/);
  });
});
