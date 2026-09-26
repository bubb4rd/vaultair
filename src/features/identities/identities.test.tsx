import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AccountDetail,
  AccountSummary,
  DashboardSummary,
  IdentityDetail,
  IdentityOverview,
  IdentityRef,
  IdentitySummary,
  PurposeView,
} from "@/ipc/client";
import { setIdentityFilter } from "@/features/dashboard/useIdentityFilter";
import { axeViolations } from "@/test/axe";
import { renderApp, type RenderOptions } from "@/test/render";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

const PURPOSES: PurposeView[] = [{ id: "builtin-main", slug: "main", name: "Main", isBuiltin: true }];

const REFS: IdentityRef[] = [
  { id: "i1", name: "Competitive", color: "rose" },
  { id: "i2", name: "Creator", color: "violet" },
];

const SUMMARIES: IdentitySummary[] = [
  {
    id: "i1",
    name: "Competitive",
    description: "Ranked accounts",
    primaryEmail: "ranked@example.com",
    color: "rose",
    accountCount: 2,
    accountsWithoutMfa: 1,
    archivedAt: null,
    updatedAt: "2026-09-20T10:00:00Z",
  },
  {
    id: "i2",
    name: "Creator",
    description: null,
    primaryEmail: null,
    color: "violet",
    accountCount: 0,
    accountsWithoutMfa: 0,
    archivedAt: null,
    updatedAt: "2026-09-20T10:00:00Z",
  },
];

const DETAIL: IdentityDetail = {
  id: "i1",
  name: "Competitive",
  description: "Ranked accounts",
  primaryEmail: "ranked@example.com",
  recoveryEmail: null,
  phoneRef: "Pixel, ends 42",
  notes: null,
  color: "rose",
  tags: ["esports"],
  archivedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
};

const arena = {
  id: "a1",
  title: "Arena ranked",
  accountType: "game" as const,
  status: "active" as const,
  purposeName: "Ranked",
  mfaEnabled: true,
};
const alt = { ...arena, id: "a2", title: "Arena alt", purposeName: "Alt", mfaEnabled: false };
const email = (value: string, accountCount: number) => ({
  id: `c-${value}`,
  kind: "email" as const,
  value,
  label: null,
  identityId: null,
  accountCount,
});

const OVERVIEW: IdentityOverview = {
  identity: DETAIL,
  accountCount: 2,
  groups: [{ platform: "Arena Co", accounts: [alt, arena] }],
  platforms: ["Arena Co"],
  sharedEmails: [{ contact: email("ranked@example.com", 3), accounts: [alt, arena] }],
  recoveryMethods: [email("main@example.com", 5)],
  dependencies: [
    {
      contact: email("ranked@example.com", 3),
      mailbox: "no_mfa",
      mailboxAccounts: [{ ...arena, id: "m1", title: "Ranked mail", accountType: "email", mfaEnabled: false }],
      dependents: [
        { account: alt, role: "login_email" },
        { account: arena, role: "login_email" },
      ],
    },
    {
      contact: email("main@example.com", 5),
      mailbox: "mfa_on",
      mailboxAccounts: [],
      dependents: [{ account: arena, role: "recovery_email" }],
    },
  ],
};

const account = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "a3",
  title: "Loose account",
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
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
  backupCodesRemaining: 0,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: [],
  updatedAt: "2026-09-20T10:00:00Z",
  // Relative to now, so the account reads as Active whenever the tests run.
  lastActivityAt: new Date().toISOString(),
  ...over,
});

function withIdentities(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      identity_list: (a) => (a.archived ? [] : SUMMARIES),
      identity_refs: () => REFS,
      identity_get: () => DETAIL,
      identity_overview: () => OVERVIEW,
      account_list: () => [
        account(),
        account({ id: "a4", title: "Stream", identityId: "i2", identityName: "Creator" }),
        account({ id: "a1", title: "Arena ranked", identityId: "i1", identityName: "Competitive" }),
      ],
      purpose_list: () => PURPOSES,
      tag_list: () => [],
      contact_point_list: () => [],
      ...extra,
    },
  };
}

describe("identity list", () => {
  it("shows an empty state that leads to the form", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/identities", withIdentities({ identity_list: () => [] }));
    expect(await screen.findByRole("heading", { name: "No identities yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Create an identity" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/identities/new");
    });
  });

  it("lists identities with their account counts and MFA gaps", async () => {
    await renderApp("/identities", withIdentities());
    const list = await screen.findByRole("list", { name: "Identities" });
    const [competitive, creator, ...rest] = within(list).getAllByRole("listitem");
    expect(rest).toHaveLength(0);
    if (!competitive || !creator) throw new Error("expected two identity cards");
    expect(within(competitive).getByText("2 accounts")).toBeInTheDocument();
    expect(within(competitive).getByText("1 without MFA")).toBeInTheDocument();
    expect(within(creator).getByText("0 accounts")).toBeInTheDocument();
  });

  it("switches to archived identities", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/identities", withIdentities());
    await user.click(await screen.findByRole("button", { name: "Archived" }));
    expect(await screen.findByRole("heading", { name: "No archived identities" })).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "identity_list", args: { archived: true } });
  });
});

describe("identity form", () => {
  it("requires a name, then creates the identity", async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderApp("/identities/new", withIdentities({ identity_create: () => DETAIL }));
    await user.click(await screen.findByRole("button", { name: "Create identity" }));
    expect(await screen.findByText("Enter a name for this identity.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(calls.some((c) => c.cmd === "identity_create")).toBe(false);

    await user.type(screen.getByLabelText("Name"), "Competitive");
    await user.type(screen.getByLabelText("Primary email"), "ranked@example.com");
    await user.type(screen.getByLabelText("Phone"), "Pixel, ends 42");
    await user.click(screen.getByRole("radio", { name: "Rose" }));
    await user.click(screen.getByRole("button", { name: "Create identity" }));

    const create = calls.find((c) => c.cmd === "identity_create");
    expect(create?.args.input).toEqual({
      name: "Competitive",
      description: null,
      primaryEmail: "ranked@example.com",
      recoveryEmail: null,
      phoneRef: "Pixel, ends 42",
      notes: null,
      color: "rose",
      tags: [],
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/identities/i1");
    });
  });

  it("says when a name is taken", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/identities/new",
      withIdentities({
        identity_create: () => {
          throw { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "name" };
        },
      }),
    );
    await user.type(await screen.findByLabelText("Name"), "Creator");
    await user.click(screen.getByRole("button", { name: "Create identity" }));
    expect(await screen.findByText("Another identity already has this name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("puts an invalid email error on its field", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/identities/i1/edit",
      withIdentities({
        identity_update: () => {
          throw { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "recoveryEmail" };
        },
      }),
    );
    await user.type(await screen.findByLabelText("Recovery email"), "nope");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeInTheDocument();
    expect(screen.getByLabelText("Recovery email")).toHaveFocus();
  });
});

describe("identity detail", () => {
  it("shows accounts by platform, shared emails and recovery dependencies", async () => {
    await renderApp("/identities/i1", withIdentities());
    const accounts = await screen.findByRole("list", { name: "Arena Co accounts" });
    expect(within(accounts).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Platforms used" })).toHaveTextContent("Arena Co");

    const deps = screen.getByRole("region", { name: "Recovery dependencies" });
    expect(within(deps).getByText("Mailbox has no MFA")).toBeInTheDocument();
    expect(within(deps).getByText("Mailbox has MFA")).toBeInTheDocument();
    const onRanked = within(deps).getByRole("list", { name: "Accounts depending on ranked@example.com" });
    expect(within(onRanked).getAllByText("Signs in with it")).toHaveLength(2);
    expect(within(deps).getByText("Resets through it")).toBeInTheDocument();

    const emails = screen.getByRole("region", { name: "Emails" });
    expect(within(emails).getByText("Shared by 3")).toBeInTheDocument();
  });

  it("assigns accounts in bulk, leaving out ones already in it", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/identities/i1", withIdentities({ identity_assign_accounts: () => 2 }));
    await user.click(await screen.findByRole("button", { name: "Assign accounts" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Arena ranked")).not.toBeInTheDocument();
    expect(within(dialog).getByText("owl · In Creator")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: /Loose account/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Stream/ }));
    await user.click(within(dialog).getByRole("button", { name: "Assign 2 accounts" }));
    expect(calls).toContainEqual({
      cmd: "identity_assign_accounts",
      args: { identityId: "i1", accountIds: ["a3", "a4"] },
    });
  });

  it("removes one account from the identity", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/identities/i1", withIdentities({ identity_assign_accounts: () => 1 }));
    await user.click(await screen.findByRole("button", { name: "Remove Arena alt from this identity" }));
    expect(calls).toContainEqual({ cmd: "identity_assign_accounts", args: { identityId: null, accountIds: ["a2"] } });
  });

  it("deletes only after the name is typed, moving accounts if asked", async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderApp("/identities/i1", withIdentities({ identity_delete: () => null }));
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole("radio", { name: "Move them to another identity" }));
    expect(within(dialog).getByRole("combobox", { name: "Move accounts to" })).toHaveValue("i2");
    await user.type(within(dialog).getByLabelText("Type “Competitive” to confirm"), "Competitive");
    await user.click(confirm);
    expect(calls).toContainEqual({
      cmd: "identity_delete",
      args: { id: "i1", confirmName: "Competitive", plan: { action: "reassign", identityId: "i2" } },
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/identities");
    });
  });
});

describe("account form identity fields", () => {
  const detail: AccountDetail = {
    id: "a1",
    title: "Arena ranked",
    accountType: "game",
    purposeId: "builtin-main",
    purposeName: "Main",
    status: "active",
    identityId: "i1",
    identityName: "Competitive",
    username: null,
    email: "ranked@example.com",
    recoveryEmail: "main@example.com",
    recoveryPhone: null,
    hasPassword: false,
    passwordStrength: null,
    passwordChangedAt: null,
    websiteUrl: null,
    loginUrl: null,
    catalogLoginUrl: null,
    platformId: null,
    platformName: null,
    platformIcon: null,
    gameId: null,
    gameName: null,
    gameIcon: null,
    publisher: null,
    region: null,
    playerId: null,
    displayName: null,
    notes: null,
    hasSensitiveNotes: false,
    notesSuggestions: { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false },
    favorite: false,
    archivedAt: null,
    lastVerifiedAt: null,
    lastUsedAt: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-20T10:00:00Z",
    // Relative to now, so the account reads as Active whenever the tests run.
    lastActivityAt: new Date().toISOString(),
    tags: [],
    customFields: [],
    mfa: [],
  };

  it("sends the identity and recovery contacts", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1/edit",
      withIdentities({ account_get: () => detail, account_update: () => detail }),
    );
    const identity = await screen.findByLabelText("Identity");
    expect(identity).toHaveValue("i1");
    await user.selectOptions(identity, "i2");
    await user.type(screen.getByLabelText("Recovery phone"), "Pixel, ends 42");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const update = calls.find((c) => c.cmd === "account_update");
    expect(update?.args.input).toMatchObject({
      identityId: "i2",
      recoveryEmail: "main@example.com",
      recoveryPhone: "Pixel, ends 42",
    });
  });

  it("links the account to its identity", async () => {
    await renderApp("/accounts/a1", withIdentities({ account_get: () => detail }));
    const link = await screen.findByRole("link", { name: "Competitive" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/identities/i1"));
    expect(screen.getByText("main@example.com")).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  const summary = (identityId: string | null): DashboardSummary => ({
    identityId,
    totalAccounts: identityId ? 2 : 5,
    mainAccounts: 1,
    altAccounts: 1,
    identities: identityId ? 1 : 2,
    missingMfa: identityId ? 0 : 3,
    favorites: 1,
    recent: [account({ id: "a1", title: "Arena ranked", identityId: "i1", identityName: "Competitive" })],
    weak: 0,
    reused: 0,
    missingRecoveryCodes: 0,
    dormant: 0,
    needsAttention: [],
  });

  it("filters the summary by identity", async () => {
    setIdentityFilter(null);
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/",
      withIdentities({ dashboard_summary: (a) => summary((a.identityId as string | null) ?? null) }),
    );
    expect(await screen.findByText("Needs MFA")).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "dashboard_summary", args: { identityId: null } });

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by identity" }), "i1");
    expect(await screen.findByText("All covered")).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "dashboard_summary", args: { identityId: "i1" } });
    expect(screen.getByText("only.").parentElement).toHaveTextContent(/Showing.*Competitive.*only./);
    setIdentityFilter(null);
  });

  it("shows the empty state for a new vault", async () => {
    setIdentityFilter(null);
    await renderApp(
      "/",
      withIdentities({ dashboard_summary: () => ({ ...summary(null), totalAccounts: 0, recent: [] }) }),
    );
    expect(await screen.findByRole("heading", { name: "Your vault at a glance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add identity" })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it.each([
    ["the identity list", "/identities", "Ranked accounts"],
    ["the identity detail", "/identities/i1", "Recovery dependencies"],
    ["the identity form", "/identities/new", "Create identity"],
    ["the dashboard", "/", "Recently edited"],
  ])("%s has no axe violations", async (_name, path, ready) => {
    setIdentityFilter(null);
    const { container } = await renderApp(
      path,
      withIdentities({
        dashboard_summary: () => ({
          identityId: null,
          totalAccounts: 3,
          mainAccounts: 1,
          altAccounts: 1,
          identities: 2,
          missingMfa: 1,
          favorites: 0,
          recent: [account()],
          weak: 0,
          reused: 0,
          missingRecoveryCodes: 0,
          dormant: 0,
          needsAttention: [],
        }),
      }),
    );
    await screen.findAllByText(ready);
    expect(await axeViolations(container)).toEqual([]);
  });
});
