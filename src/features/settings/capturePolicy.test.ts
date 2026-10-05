import { describe, expect, it } from "vitest";
import type { Status } from "@/components/common/StatusBadge";
import type { CaptureLevel } from "@/ipc/client";
import { accountIdFromPath, shouldHideCapture, wantsWindowHidden } from "./capturePolicy";

const LEVELS: CaptureLevel[] = ["risk", "warning", "attention"];
const BANDS: Status[] = ["risk", "warning", "attention", "secure"];

describe("shouldHideCapture", () => {
  it("hides an account at or below the chosen rating", () => {
    const hidden: Record<CaptureLevel, Status[]> = {
      risk: ["risk"],
      warning: ["risk", "warning"],
      attention: ["risk", "warning", "attention"],
    };
    for (const level of LEVELS) {
      for (const status of BANDS) {
        expect(shouldHideCapture(level, status)).toBe(hidden[level].includes(status));
      }
    }
  });

  it("leaves archived and unscored accounts visible", () => {
    for (const level of LEVELS) {
      expect(shouldHideCapture(level, "archived")).toBe(false);
      expect(shouldHideCapture(level, "unknown")).toBe(false);
    }
  });
});

describe("wantsWindowHidden", () => {
  const custom = { mode: "custom" as const, level: "warning" as const };

  it("leaves Always and Off alone", () => {
    expect(wantsWindowHidden({ ...custom, mode: "always", accountId: null, archived: false, status: null })).toBeNull();
    expect(wantsWindowHidden({ ...custom, mode: "off", accountId: "a1", archived: false, status: "risk" })).toBeNull();
  });

  it("hides only while a qualifying account is open, and while it is still loading", () => {
    expect(wantsWindowHidden({ ...custom, accountId: null, archived: false, status: null })).toBe(false);
    expect(wantsWindowHidden({ ...custom, accountId: "a1", archived: null, status: null })).toBe(true);
    expect(wantsWindowHidden({ ...custom, accountId: "a1", archived: true, status: null })).toBe(false);
    expect(wantsWindowHidden({ ...custom, accountId: "a1", archived: false, status: null })).toBe(true);
    expect(wantsWindowHidden({ ...custom, accountId: "a1", archived: false, status: "warning" })).toBe(true);
    expect(wantsWindowHidden({ ...custom, accountId: "a1", archived: false, status: "secure" })).toBe(false);
  });
});

describe("accountIdFromPath", () => {
  it("reads detail and edit routes, and skips a new account", () => {
    expect(accountIdFromPath("/accounts/a1")).toBe("a1");
    expect(accountIdFromPath("/accounts/a1/edit")).toBe("a1");
    expect(accountIdFromPath("/accounts/new")).toBeNull();
    expect(accountIdFromPath("/accounts")).toBeNull();
    expect(accountIdFromPath("/settings")).toBeNull();
  });
});
