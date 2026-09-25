import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { TOUCH_INTERVAL_MS } from "./ActivityTracker";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("activity tracker", () => {
  it("pings Rust at most once per interval, reporting the last activity when it ends", async () => {
    const { calls } = await renderApp("/");
    // Fakes setTimeout and performance.now together.
    vi.useFakeTimers();
    const advance = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };
    const touches = () => calls.filter((c) => c.cmd === "session_touch").length;
    const before = touches();

    fireEvent.keyDown(window, { key: "a" });
    expect(touches()).toBe(before + 1);

    // Activity inside the interval is held back...
    advance(5_000);
    fireEvent.pointerMove(window);
    fireEvent.pointerDown(window);
    fireEvent.wheel(window);
    expect(touches()).toBe(before + 1);

    // ...and sent once, when the interval ends.
    advance(TOUCH_INTERVAL_MS - 5_000);
    expect(touches()).toBe(before + 2);

    // No activity, no pings.
    advance(TOUCH_INTERVAL_MS * 4);
    expect(touches()).toBe(before + 2);

    fireEvent.pointerDown(window);
    expect(touches()).toBe(before + 3);
  });

  it("doesn't run while locked", async () => {
    const { calls } = await renderApp("/", { unlocked: false });
    fireEvent.keyDown(window, { key: "a" });
    expect(calls.some((c) => c.cmd === "session_touch")).toBe(false);
  });
});
