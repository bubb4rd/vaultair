import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";
import type { AccountDetail, IdentityOverview } from "@/ipc/client";

const mockAccount: AccountDetail = {
  id: "a1",
  title: "Steam Main",
  accountType: "platform",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: "i1",
  identityName: "Competitive",
  username: "gamer",
  email: "gamer@example.com",
  platformId: null,
  platformName: null,
  platformIcon: null,
  catalogLoginUrl: null,
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  hasPassword: true,
  passwordStrength: 4,
  mfaEnabled: true,
  backupCodesRemaining: 5,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: ["gaming"],
  updatedAt: "2026-10-01T12:00:00Z",
  lastActivityAt: "2026-10-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  lastVerifiedAt: null,
  loginUrl: "https://store.steampowered.com/login",
  websiteUrl: "https://store.steampowered.com",
  region: "NA",
  playerId: null,
  displayName: "ProPlayer",
  recoveryEmail: null,
  recoveryPhone: null,
  notes: null,
  hasSensitiveNotes: false,
  notesSuggestions: { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false },
  customFields: [],
  gameProfiles: [],
  totpConfigured: false,
  mfa: [],
};

const mockIdentity: IdentityOverview = {
  identity: {
    id: "i1",
    name: "Competitive",
    description: "Ranked accounts",
    primaryEmail: "ranked@example.com",
    recoveryEmail: null,
    phoneRef: null,
    notes: null,
    color: "violet",
    tags: ["esports"],
    archivedAt: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-20T10:00:00Z",
  },
  accountCount: 1,
  groups: [],
  platforms: [],
  sharedEmails: [],
  recoveryMethods: [],
  dependencies: [],
};

describe("PageHeader breadcrumbs", () => {
  it("renders two-segment breadcrumbs on top-level pages by default", async () => {
    await renderApp("/");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();

    const vaultLink = within(nav).getByRole("link", { name: "Vault" });
    expect(vaultLink).toHaveAttribute("href", "/");
    expect(vaultLink).not.toHaveAttribute("data-tauri-drag-region");

    const currentHeading = within(nav).getByRole("heading", { level: 1, name: "Dashboard" });
    expect(currentHeading).toHaveAttribute("aria-current", "page");
    expect(currentHeading).toHaveAttribute("data-tauri-drag-region");
  });

  it("ensures non-interactive elements carry data-tauri-drag-region while link does not", async () => {
    await renderApp("/identities");
    const header = (await screen.findByRole("heading", { level: 1, name: "Identities" })).closest("header");
    expect(header).toHaveAttribute("data-tauri-drag-region");

    const nav = within(header as HTMLElement).getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveAttribute("data-tauri-drag-region");

    const vaultLink = within(nav).getByRole("link", { name: "Vault" });
    expect(vaultLink).not.toHaveAttribute("data-tauri-drag-region");

    const heading = within(nav).getByRole("heading", { level: 1, name: "Identities" });
    expect(heading).toHaveAttribute("data-tauri-drag-region");
  });

  it("renders 3-segment trail on active account detail page and navigates parents", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/accounts/a1", {
      handlers: {
        account_get: () => mockAccount,
      },
    });

    const heading = await screen.findByRole("heading", { level: 1, name: "Steam Main" });
    expect(heading).toHaveAttribute("aria-current", "page");

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Vault" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "All Accounts" })).toHaveAttribute("href", "/accounts");

    // Clicking 'All Accounts' navigates back to /accounts
    await user.click(within(nav).getByRole("link", { name: "All Accounts" }));
    expect(router.state.location.pathname).toBe("/accounts");
  });

  it("renders Archived parent on archived account detail page", async () => {
    await renderApp("/accounts/a1", {
      handlers: {
        account_get: () => ({ ...mockAccount, archivedAt: "2026-10-02T12:00:00Z" }),
      },
    });

    const heading = await screen.findByRole("heading", { level: 1, name: "Steam Main" });
    expect(heading).toHaveAttribute("aria-current", "page");

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Vault" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Archived" })).toHaveAttribute("href", "/archived");
  });

  it("renders 3-segment trail on identity detail page", async () => {
    await renderApp("/identities/i1", {
      handlers: {
        identity_overview: () => mockIdentity,
      },
    });

    const heading = await screen.findByRole("heading", { level: 1, name: "Competitive" });
    expect(heading).toHaveAttribute("aria-current", "page");

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Vault" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Identities" })).toHaveAttribute("href", "/identities");
  });

  it("has no axe violations on breadcrumb navigation", async () => {
    const { container } = await renderApp("/accounts/a1", {
      handlers: {
        account_get: () => mockAccount,
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Steam Main" });
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
    expect(await axeViolations(header as HTMLElement)).toEqual([]);
  });
});
