import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { AccountSummary, DashboardSummary, IdentityRef } from "@/ipc/client";
import { setIdentityFilter } from "@/features/dashboard/useIdentityFilter";
import { TEST_VAULT, renderApp, type RenderOptions } from "@/test/render";

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
/** Noon `n` local days ago, clear of midnight and daylight-saving edges. */
const daysAgo = (n: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).toISOString();
};

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
  // Now, not an hour ago: in the first hour of a day, an hour ago is yesterday.
  updatedAt: ago(0),
  lastActivityAt: ago(0),
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
  accountsCreatedAt: [ago(0)],
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

/** Dot counts keyed by column x, so a test can see height and how many columns exist. */
async function dotColumns(name: RegExp): Promise<Map<string, number>> {
  const svg = await screen.findByRole("img", { name });
  const byX = new Map<string, number>();
  for (const circle of svg.querySelectorAll("circle")) {
    const x = circle.getAttribute("cx") ?? "";
    byX.set(x, (byX.get(x) ?? 0) + 1);
  }
  return byX;
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

  /** The vault was created `days` ago. */
  const createdDaysAgo = (days: number) => ({
    vault_status: () => ({ state: "unlocked", vault: { ...TEST_VAULT, createdAt: daysAgo(days) } }),
  });

  it("shows the vault split, MFA coverage and the open issues", async () => {
    await renderApp("/", handlers());
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();

    // The split bar has no legend: each segment carries its own words.
    expect(await screen.findByRole("img", { name: "Main: 8 accounts" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alt: 4 accounts" })).toBeInTheDocument();
    const favorites = screen.getByText("favorites");
    expect(within(favorites).getByText("2")).toBeInTheDocument();

    // 9 of 12 have MFA.
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3 without MFA" })).toHaveAttribute("href", "/health");

    // Today's health, live: 1 weak + 3 missing MFA + 1 missing codes + 2 dormant.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("open issues")).toBeInTheDocument();
    const checks = within(screen.getByRole("list", { name: "Open issues by check" })).getAllByRole("listitem");
    expect(checks.map((li) => li.textContent)).toEqual([
      "Weak passwords1",
      "Reused passwords0",
      "Missing MFA3",
      "Missing recovery codes1",
      "Dormant2",
    ]);
    expect(screen.getByRole("link", { name: "Open Security Health" })).toHaveAttribute("href", "/health");
  });

  it("plots account growth from the day the vault was created, blank before the first account", async () => {
    await renderApp(
      "/",
      handlers({
        ...createdDaysAgo(10),
        dashboard_summary: () => summary({ accountsCreatedAt: [daysAgo(7), daysAgo(7), daysAgo(2)] }),
      }),
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Account growth" })).toBeInTheDocument();
    const chart = await screen.findByRole("img", { name: /^Account growth since .+: 3 accounts added\. Deleted accounts aren't counted\.$/ });
    // Eleven days, one column each from the left. The first three are before any account.
    expect(await dotColumns(/^Account growth since/)).toEqual(
      new Map([
        ["33.5", 2],
        ["42.5", 2],
        ["51.5", 2],
        ["60.5", 2],
        ["69.5", 2],
        ["78.5", 3],
        ["87.5", 3],
        ["96.5", 3],
      ]),
    );
    const firstLabel = chart.querySelector("text")?.textContent;
    expect(firstLabel).toBe(new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(daysAgo(10))));
  });

  it("compresses a vault older than the plot and scales a total past the rows", async () => {
    const early = Array.from({ length: 30 }, () => daysAgo(195));
    const late = Array.from({ length: 30 }, () => daysAgo(0));
    await renderApp(
      "/",
      handlers({ ...createdDaysAgo(200), dashboard_summary: () => summary({ accountsCreatedAt: [...early, ...late] }) }),
    );
    const columns = await dotColumns(/^Account growth since .+: 60 accounts added/);
    // 201 days in 66 columns of about three days. The first run is before any account.
    expect(columns.has("6.5")).toBe(false);
    expect(columns.size).toBe(65);
    // 60 fills the 18 rows, so 30 draws 9.
    expect(columns.get("15.5")).toBe(9);
    expect(Math.max(...columns.values())).toBe(18);
    expect(Math.max(...[...columns.keys()].map(Number))).toBeGreaterThan(500);
  });

  it("says when no account has been added for the chosen identity", async () => {
    setIdentityFilter("i1");
    await renderApp("/", handlers({ dashboard_summary: () => summary({ identityId: "i1", totalAccounts: 0, accountsCreatedAt: [] }) }));
    expect(await screen.findByText("Accounts appear here as you add them.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Account growth/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Backup settings" })).toHaveAttribute("href", "/settings#backup-heading");
    const actions = within(screen.getByRole("region", { name: "Quick actions" })).getAllByRole("link");
    expect(actions.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Add account", "/accounts/new"],
      ["Add identity", "/identities/new"],
    ]);
  });

  it("offers the same two quick actions on an empty vault", async () => {
    await renderApp(
      "/",
      handlers({
        dashboard_summary: () =>
          summary({ totalAccounts: 0, mainAccounts: 0, altAccounts: 0, recent: [], needsAttention: [], accountsCreatedAt: [] }),
      }),
    );
    const region = await screen.findByRole("region", { name: "Quick actions" });
    expect(within(region).getAllByRole("link").map((a) => a.textContent)).toEqual(["Add account", "Add identity"]);
  });

  it("says when there is no backup yet", async () => {
    await renderApp("/", handlers());
    expect(await screen.findByText("No backup yet")).toBeInTheDocument();
  });
});
