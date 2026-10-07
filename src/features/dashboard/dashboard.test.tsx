import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { AccountSummary, DashboardSummary, IdentityRef } from "@/ipc/client";
import { setIdentityFilter } from "@/features/dashboard/useIdentityFilter";
import { renderApp, type RenderOptions } from "@/test/render";

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const account = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "a1",
  title: "Steam",
  accountType: "platform",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: "i1",
  identityName: "Competitive",
  username: "owl",
  email: null,
  platformId: null,
  platformName: null,
  platformIcon: null,
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  hasPassword: true,
  passwordStrength: 4,
  mfaEnabled: true,
  backupCodesRemaining: 8,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: [],
  updatedAt: ago(1),
  lastActivityAt: ago(1),
  ...over,
});

const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  identityId: null,
  totalAccounts: 12,
  mainAccounts: 8,
  altAccounts: 4,
  identities: 2,
  missingMfa: 3,
  favorites: 2,
  recent: [
    account({ favorite: true }),
    account({ id: "a2", title: "Discord", accountType: "social", updatedAt: ago(50), lastActivityAt: ago(50) }),
  ],
  weak: 1,
  reused: 0,
  missingRecoveryCodes: 1,
  dormant: 2,
  needsAttention: [
    { accountId: "a1", title: "Steam", rule: "weak", severity: "high", reason: "This password is weak.", fix: "edit_account" },
  ],
  ...over,
});

function handlers(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      identity_refs: () => [{ id: "i1", name: "Competitive", color: "violet" }] as IdentityRef[],
      dashboard_summary: () => summary(),
      ...extra,
    },
  };
}

/**
 * jsdom lays nothing out, so the chart would never get a width. This
 * observer reports one at once, which is enough for the SVG to render.
 */
class SizedObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 600 } } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}

describe("dashboard", () => {
  let original: typeof ResizeObserver;
  beforeEach(() => {
    original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = SizedObserver;
    setIdentityFilter(null);
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it("shows the vault split, MFA coverage and the open issues", async () => {
    await renderApp("/", handlers());
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();

    // The split bar has no legend: each segment carries its own words.
    expect(await screen.findByRole("img", { name: "Main: 8 accounts" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alt: 4 accounts" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("favorites")).toBeInTheDocument();

    // 9 of 12 have MFA.
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3 without MFA" })).toHaveAttribute("href", "/health");

    // 1 weak + 3 missing MFA + 1 missing codes + 2 dormant. With no history the chart is today only.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("open issues")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /7 open issues across all active accounts\. No earlier days/ })).toBeInTheDocument();
    expect(screen.getByText(/History builds up from today/)).toBeInTheDocument();
  });

  it("groups recent activity by day and lists the open issues beside it", async () => {
    await renderApp("/", handlers());
    const activity = await screen.findByRole("list", { name: "Recently edited accounts, newest first" });
    expect(within(activity).getByRole("heading", { level: 3, name: "Today" })).toBeInTheDocument();
    expect(within(activity).getByRole("heading", { level: 3, name: "Earlier" })).toBeInTheDocument();
    expect(within(activity).getByRole("link", { name: "Discord" })).toHaveAttribute("href", "/accounts/a2");
    expect(within(activity).getByLabelText("Favorite")).toBeInTheDocument();

    const issues = screen.getByRole("list", { name: "Issues, highest severity first" });
    expect(within(issues).getByText("This password is weak.", { exact: false })).toBeInTheDocument();
    expect(within(issues).getByRole("link", { name: "Fix Steam" })).toHaveAttribute(
      "href",
      expect.stringContaining("/accounts/a1/edit"),
    );
    expect(screen.getByRole("link", { name: "All 7" })).toHaveAttribute("href", "/health");
  });

  it("offers the quick actions and the backup state in the strip", async () => {
    await renderApp(
      "/",
      handlers({
        backup_status: () => ({
          destination: "D:\\Backups",
          destinationAvailable: true,
          cloudProvider: null,
          // A little past 30 hours, so the whole-hour floor still reads 30 when the page renders.
          lastBackupAt: ago(30.5),
          lastBackupPath: "D:\\Backups\\Main.vaultair-backup",
          lastOutcome: null,
          lastAttemptAt: ago(30.5),
          reminderDue: false,
          reminderAfterDays: 30,
        }),
      }),
    );
    expect(await screen.findByText("Last backup 30 hours ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backup settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Add account" })).toHaveAttribute("href", "/accounts/new");
    expect(screen.getByRole("link", { name: "Add identity" })).toHaveAttribute("href", "/identities/new");
    expect(screen.getByRole("link", { name: "Review health" })).toHaveAttribute("href", "/health");
  });

  it("says when there is no backup yet", async () => {
    await renderApp("/", handlers());
    expect(await screen.findByText("No backup yet")).toBeInTheDocument();
  });
});
