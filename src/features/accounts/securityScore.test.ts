import { describe, expect, it } from "vitest";
import type { HealthIssue } from "@/ipc/client";
import { formatDate } from "./labels";
import { securityScore, type SecurityFacts } from "./securityScore";

function facts(over: Partial<SecurityFacts> = {}): SecurityFacts {
  return {
    archived: false,
    passwordStrength: 4,
    passwordChangedAt: null,
    mfaEnabled: 1,
    mfaRecorded: 1,
    backupCodesRemaining: 3,
    issues: [],
    ...over,
  };
}

function issue(over: Partial<HealthIssue> = {}): HealthIssue {
  return {
    accountId: "a1",
    title: "Steam",
    rule: "reused",
    severity: "high",
    reason: "Same password as 3 other accounts.",
    fix: "edit_account",
    ...over,
  };
}

describe("securityScore", () => {
  it("scores a good password with no MFA and a reused password as high risk", () => {
    const changed = "2026-09-25T15:00:00Z";
    const result = securityScore(
      facts({
        passwordStrength: 3,
        passwordChangedAt: changed,
        mfaEnabled: 0,
        mfaRecorded: 0,
        backupCodesRemaining: 0,
        issues: [
          issue(),
          issue({
            rule: "missing_mfa",
            severity: "medium",
            reason: "No MFA is turned on.",
            fix: "mfa_section",
          }),
        ],
      }),
    );

    expect(result.score).toBe(27);
    expect(result.status).toBe("risk");
    expect(result.label).toBe("High risk");
    expect(result.chips.map((chip) => chip.key)).toEqual(["password", "mfa", "backup", "reused"]);
    expect(result.chips[0]).toMatchObject({
      status: "secure",
      label: "Good",
      detail: `Changed ${formatDate(changed)}`,
    });
    expect(result.chips[1]).toMatchObject({
      status: "warning",
      label: "Not recorded",
      reason: "No MFA is turned on.",
    });
    expect(result.chips[2]).toMatchObject({ status: "unknown", label: "Not set" });
    expect(result.chips[3]).toMatchObject({
      status: "risk",
      label: "Reused password",
      reason: "Same password as 3 other accounts.",
    });
  });

  it("scores a strong password with MFA and backup codes as secure", () => {
    const result = securityScore(facts());
    expect(result.score).toBe(100);
    expect(result.status).toBe("secure");
    expect(result.label).toBe("Secure");
    expect(result.chips.map((chip) => [chip.key, chip.label])).toEqual([
      ["password", "Strong"],
      ["mfa", "On"],
      ["backup", "3 left"],
    ]);
  });

  it("treats a missing password as a 40 point deduction", () => {
    const result = securityScore(facts({ passwordStrength: null }));
    expect(result.score).toBe(60);
    expect(result.status).toBe("warning");
    expect(result.chips[0]).toMatchObject({ status: "unknown", label: "No password saved" });
  });

  it("does not score an archived account, and skips issue chips", () => {
    const result = securityScore(
      facts({
        archived: true,
        passwordStrength: 3,
        mfaEnabled: 0,
        mfaRecorded: 0,
        issues: [
          issue(),
          issue({ rule: "weak", reason: "This password is weak.", fix: "edit_account" }),
          issue({ rule: "dormant", severity: "info", reason: "No activity for a year.", fix: "account" }),
        ],
      }),
    );
    expect(result.score).toBeNull();
    expect(result.status).toBe("archived");
    expect(result.label).toBe("Not scored");
    expect(result.chips.map((chip) => chip.key)).toEqual(["password", "mfa", "backup"]);
    expect(result.chips.every((chip) => chip.reason === undefined && chip.issue === undefined)).toBe(true);
  });

  it("does not deduct twice for a weak password or missing MFA", () => {
    const weak = securityScore(
      facts({
        passwordStrength: 1,
        issues: [issue({ rule: "weak", reason: "This password is weak.", fix: "edit_account" })],
      }),
    );
    expect(weak.score).toBe(68);
    expect(weak.chips.filter((chip) => chip.key === "password")).toHaveLength(1);
    expect(weak.chips[0]).toMatchObject({ label: "Weak", reason: "This password is weak." });

    const mfa = securityScore(
      facts({
        mfaEnabled: 0,
        mfaRecorded: 0,
        backupCodesRemaining: 0,
        issues: [issue({ rule: "missing_mfa", severity: "medium", reason: "No MFA is turned on.", fix: "mfa_section" })],
      }),
    );
    expect(mfa.score).toBe(65);
    expect(mfa.chips.filter((chip) => chip.key === "mfa")).toHaveLength(1);
    expect(mfa.chips.find((chip) => chip.key === "missing_mfa")).toBeUndefined();
  });

  it("does not deduct twice when backup codes are missing", () => {
    const result = securityScore(
      facts({
        backupCodesRemaining: 0,
        issues: [
          issue({
            rule: "missing_recovery_codes",
            severity: "low",
            reason: "MFA is on, but no backup codes are saved.",
            fix: "mfa_section",
          }),
        ],
      }),
    );
    expect(result.score).toBe(88);
    expect(result.status).toBe("attention");
    expect(result.chips[2]).toMatchObject({
      label: "None saved",
      reason: "MFA is on, but no backup codes are saved.",
    });
  });

  it("leaves reuse out of the score while issues are still loading", () => {
    const result = securityScore(
      facts({
        passwordStrength: 3,
        mfaEnabled: 0,
        mfaRecorded: 0,
        backupCodesRemaining: 0,
        issues: null,
      }),
    );
    expect(result.score).toBe(57);
    expect(result.chips.map((chip) => chip.key)).toEqual(["password", "mfa", "backup"]);
  });

  it("shows a dormant account as a chip without changing the score", () => {
    const result = securityScore(
      facts({
        issues: [issue({ rule: "dormant", severity: "info", reason: "No activity for a year.", fix: "account" })],
      }),
    );
    expect(result.score).toBe(100);
    expect(result.chips[3]).toMatchObject({ key: "dormant", status: "dormant", label: "Dormant" });
  });

  it("clamps a stack of deductions at zero", () => {
    const result = securityScore(
      facts({
        passwordStrength: 0,
        mfaEnabled: 0,
        mfaRecorded: 1,
        backupCodesRemaining: 0,
        issues: [issue()],
      }),
    );
    expect(result.score).toBe(0);
    expect(result.status).toBe("risk");
    expect(result.chips[1]).toMatchObject({ label: "Turned off" });
  });

  it("places the band edges on the deductions that land there", () => {
    expect(securityScore(facts({ passwordStrength: 3 })).status).toBe("secure");
    expect(securityScore(facts({ backupCodesRemaining: 0 })).status).toBe("attention");
    expect(securityScore(facts({ issues: [issue()] })).score).toBe(70);
    expect(securityScore(facts({ issues: [issue()] })).status).toBe("attention");
    expect(
      securityScore(facts({ passwordStrength: 2, backupCodesRemaining: 0, issues: [issue()] })).score,
    ).toBe(40);
    expect(
      securityScore(facts({ passwordStrength: 2, backupCodesRemaining: 0, issues: [issue()] })).status,
    ).toBe("warning");
    expect(securityScore(facts({ passwordStrength: 1, issues: [issue()] })).score).toBe(38);
    expect(securityScore(facts({ passwordStrength: 1, issues: [issue()] })).status).toBe("risk");
  });
});
