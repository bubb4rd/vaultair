import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_DURATION, EXIT_MS, MAX_TOASTS, toast } from "@/features/toast/toast";
import { Toaster } from "./Toaster";

const items = () => Array.from(document.querySelectorAll("[data-toast-id]"));
const open = () => items().filter((el) => !el.hasAttribute("data-closing"));
const live = (kind: "polite" | "assertive") => document.querySelector(`[data-toast-live="${kind}"]`);

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  render(<Toaster />);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toasts", () => {
  it("shows kind, title, description and shortcut keycaps", () => {
    act(() => {
      toast.info("Vault locked", { description: "Lock anytime with", shortcut: ["Ctrl", "L"] });
    });
    const [el] = items();
    expect(el).toHaveAttribute("data-kind", "info");
    expect(el).toHaveTextContent("Vault locked");
    expect(screen.getByLabelText("Ctrl+L")).toBeInTheDocument();
    expect(live("polite")).toHaveTextContent("Vault locked. Lock anytime with");
  });

  it("announces errors assertively", () => {
    act(() => {
      toast.error("Couldn't save", { description: "Your vault was not changed." });
    });
    expect(live("assertive")).toHaveTextContent("Couldn't save. Your vault was not changed.");
    expect(live("polite")).toBeEmptyDOMElement();
  });

  it("closes itself after its duration, with an exit transition", () => {
    act(() => {
      toast.success("Saved");
    });
    advance(DEFAULT_DURATION.success - 1);
    expect(open()).toHaveLength(1);
    advance(1);
    // Still in the DOM while it animates out...
    expect(items()[0]).toHaveAttribute("data-closing");
    advance(EXIT_MS);
    // ...then gone.
    expect(items()).toHaveLength(0);
  });

  it("pauses while hovered", () => {
    act(() => {
      toast.success("Saved");
    });
    const card = items()[0]?.querySelector("[data-slot='toast']");
    if (!card) throw new Error("toast card not rendered");
    advance(1000);
    fireEvent.pointerEnter(card);
    advance(DEFAULT_DURATION.success * 2);
    expect(open()).toHaveLength(1);
    fireEvent.pointerLeave(card);
    advance(DEFAULT_DURATION.success - 1000 - 1);
    expect(open()).toHaveLength(1);
    advance(1);
    expect(open()).toHaveLength(0);
  });

  it("stays until dismissed when duration is null", () => {
    act(() => {
      toast.info("Copied", { duration: null });
    });
    advance(60_000);
    expect(open()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    advance(EXIT_MS);
    expect(items()).toHaveLength(0);
  });

  it("replaces a toast that reuses an id, restarting its timer", () => {
    act(() => {
      toast.info("Copied", { id: "clip" });
    });
    advance(DEFAULT_DURATION.info - 100);
    act(() => {
      toast.success("Cleared", { id: "clip" });
    });
    expect(items()).toHaveLength(1);
    expect(items()[0]).toHaveTextContent("Cleared");
    advance(DEFAULT_DURATION.success - 1);
    expect(open()).toHaveLength(1);
  });

  it(`keeps at most ${String(MAX_TOASTS)} on screen, closing the oldest`, () => {
    act(() => {
      for (let i = 0; i < MAX_TOASTS + 2; i++) toast.info(`Toast ${String(i)}`);
    });
    expect(open()).toHaveLength(MAX_TOASTS);
    // Newest first at the top; the oldest two are closing.
    expect(open()[0]).toHaveTextContent("Toast 4");
    expect(open()[MAX_TOASTS - 1]).toHaveTextContent("Toast 2");
    advance(EXIT_MS);
    expect(items()).toHaveLength(MAX_TOASTS);
  });

  it("runs action buttons", () => {
    const onClick = vi.fn();
    act(() => {
      toast.info("Copied", { actions: [{ label: "Keep", onClick }] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
