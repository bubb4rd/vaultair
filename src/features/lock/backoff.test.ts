import { describe, expect, it } from "vitest";
import { lockoutSeconds } from "./backoff";

describe("lockoutSeconds", () => {
  it("allows five attempts, then doubles the wait up to a minute", () => {
    expect([1, 2, 3, 4].map(lockoutSeconds)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 50].map(lockoutSeconds)).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });
});
