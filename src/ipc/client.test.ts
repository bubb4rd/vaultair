import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo, isIpcError, toIpcError } from "./client";

describe("IPC error normalisation", () => {
  it("passes well-formed AppErrors through", () => {
    const err = { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "email" };
    expect(isIpcError(err)).toBe(true);
    expect(toIpcError(err)).toBe(err);
  });

  it("replaces anything else with the generic error, dropping raw text", () => {
    for (const raw of [
      "command app_info not allowed by ACL",
      new Error("C:/Users/someone/secret path"),
      { code: "made_up", message: "x" },
      { code: "internal" },
      null,
      undefined,
    ]) {
      const out = toIpcError(raw);
      expect(out.code).toBe("internal");
      expect(JSON.stringify(out)).not.toMatch(/ACL|someone|made_up/);
    }
  });

  it("rejects with a normalised error when a command fails", async () => {
    mockIPC(() => {
      throw "raw backend failure text";
    });
    await expect(appInfo()).rejects.toEqual(expect.objectContaining({ code: "internal" }));
  });
});
