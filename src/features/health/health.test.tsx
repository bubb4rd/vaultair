import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardSummary, HealthIssue, HealthSummary, IdentityRef } from "@/ipc/client";
import { setIdentityFilter } from "@/features/dashboard/useIdentityFilter";
import { renderApp, type RenderOptions } from "@/test/render";

const issue = (over: Partial<HealthIssue> = {}): HealthIssue => ({
  accountId: "a1",
  title: "Arena alt",
  rule: "weak",
  severity: "high",
  reason: "This password is weak.",
  fix: "edit_account",
  ...over,
});

const healthSummary = (over: Partial<HealthSummary> = {}): HealthSummary => ({
  identityId: null,
  weak: 1,
  reused: 0,
  missingMfa: 0,
  missingRecoveryCodes: 0,
  dormant: 0,
  ...over,
});

const dashboardSummary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  identityId: null,
  totalAccounts: 4,
  mainAccounts: 1,
  altAccounts: 1,
  identities: 1,
  missingMfa: 0,
  favorites: 0,
  recent: [],
  weak: 2,
  reused: 1,
  missingRecoveryCodes: 3,
  dormant: 1,
  needsAttention: [issue()],
  ...over,
});

function handlers(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      identity_refs: () => [] as IdentityRef[],
      health_summary: () => healthSummary(),
      health_issues: () => [issue()],
      dashboard_summary: () => dashboardSummary(),
      ...extra,
    },
  };
}

describe("security health", () => {
  it("shows the reason and a fix link for a weak password", async () => {
    setIdentityFilter(null);
    await renderApp("/health", handlers());
    expect(await screen.findByText("This password is weak.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix Arena alt" })).toHaveAttribute(
      "href",
      expect.stringContaining("/accounts/a1/edit"),
    );
  });

  it("links a missing-codes issue to the MFA section", async () => {
    setIdentityFilter(null);
    await renderApp(
      "/health",
      handlers({
        health_summary: () => healthSummary({ weak: 0, missingRecoveryCodes: 1 }),
        health_issues: () => [
          issue({
            rule: "missing_recovery_codes",
            severity: "low",
            reason: "MFA is on, but no backup codes are saved.",
            fix: "mfa_section",
          }),
        ],
      }),
    );
    expect(await screen.findByText("MFA is on, but no backup codes are saved.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix Arena alt" })).toHaveAttribute(
      "href",
      expect.stringContaining("#mfa-heading"),
    );
  });
});

describe("dashboard health", () => {
  it("renders the health counts and a needs-attention fix", async () => {
    setIdentityFilter(null);
    await renderApp("/", handlers());
    // 2 weak + 1 reused + 3 missing codes + 1 dormant, counted once per check.
    expect(await screen.findByText("open issues")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Security Health" })).toHaveAttribute("href", "/health");
    const attention = screen.getByRole("list", { name: "Issues, highest severity first" });
    expect(within(attention).getByText("This password is weak.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix Arena alt" })).toBeInTheDocument();
  });

  it("asks for one rule when a check is chosen", async () => {
    setIdentityFilter(null);
    const user = userEvent.setup();
    const { calls } = await renderApp("/health", handlers());
    await screen.findByText("This password is weak.", { exact: false });
    await user.click(screen.getByRole("button", { name: /Missing MFA/ }));
    expect(calls).toContainEqual({
      cmd: "health_issues",
      args: { identityId: null, rule: "missing_mfa" },
    });
  });
});
