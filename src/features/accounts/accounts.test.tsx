import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SORT, EMPTY_FILTER, type AccountDetail, type AccountFilter, type AccountSummary, type PurposeView } from "@/ipc/client";
import { PAGE_PATHS } from "@/app/nav";
import { reloadWebview } from "@/lib/webview";
import { axeViolations } from "@/test/axe";
import { DEFAULT_SESSION_CONFIG, TEST_VAULT, renderApp, type RenderOptions } from "@/test/render";
import { DORMANT_AFTER_DAYS, STALE_AFTER_DAYS, displayStatus } from "./labels";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

const PURPOSES: PurposeView[] = [
  { id: "builtin-main", slug: "main", name: "Main", isBuiltin: true, isHidden: false, color: null, accountCount: 0 },
  { id: "builtin-alt", slug: "alt", name: "Alt", isBuiltin: true, isHidden: false, color: null, accountCount: 0 },
];

const summary = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "a1",
  title: "Game store (main)",
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: "nightowl@example.com",
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
  backupCodesRemaining: 2,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: ["pc"],
  updatedAt: "2026-09-20T10:00:00Z",
  // Relative to now, so the account reads as Active whenever the tests run.
  lastActivityAt: new Date().toISOString(),
  ...over,
});

const DETAIL: AccountDetail = {
  id: "a1",
  title: "Game store (main)",
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: "nightowl@example.com",
  recoveryEmail: null,
  recoveryPhone: null,
  hasPassword: true,
  passwordStrength: 4,
  passwordChangedAt: "2026-09-01T10:00:00Z",
  websiteUrl: null,
  loginUrl: "https://store.example.com/login",
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
  notes: "Main library",
  hasSensitiveNotes: false,
  notesSuggestions: { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false },
  favorite: false,
  archivedAt: null,
  lastVerifiedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
  // Relative to now, so the account reads as Active whenever the tests run.
  lastActivityAt: new Date().toISOString(),
  tags: ["pc"],
  customFields: [],
  mfa: [
    {
      id: "m1",
      method: "authenticator_app",
      enabled: true,
      hasTotp: true,
      backupCodes: [
        { index: 0, used: false },
        { index: 1, used: true },
        { index: 2, used: false },
      ],
      backupCodesRemaining: 2,
      backupCodesUpdatedAt: "2026-09-01T10:00:00Z",
      hasRecoveryInstructions: false,
      notes: null,
      updatedAt: "2026-09-01T10:00:00Z",
    },
  ],
};

/** Stands in for Rust's filtering: the archived side and the text search. */
function listFilter(list: AccountSummary[]) {
  return (a: Record<string, unknown>) => {
    const f = a.filter as AccountFilter;
    if (f.archived) return list.filter((x) => x.archivedAt !== null);
    const text = f.text?.toLowerCase();
    return list.filter(
      (x) =>
        x.archivedAt === null &&
        (!text || [x.title, x.username, x.email, ...x.tags].some((v) => v?.toLowerCase().includes(text))),
    );
  };
}

function withAccounts(extra: RenderOptions["handlers"] = {}, list: AccountSummary[] = [summary()]): RenderOptions {
  return {
    handlers: {
      account_list: listFilter(list),
      account_get: () => DETAIL,
      purpose_list: () => PURPOSES,
      tag_list: () => ["pc", "ranked"],
      ...extra,
    },
  };
}

describe("account list", () => {
  it("lists accounts and searches them in Rust", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts",
      withAccounts({}, [
        summary(),
        summary({ id: "a2", title: "Arena alt", username: "owl_alt", tags: ["ranked"], mfaEnabled: false, passwordStrength: 1 }),
      ]),
    );
    const table = await screen.findByRole("table", { name: "All Accounts" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Weak password")).toBeInTheDocument();
    expect(within(table).getByText("No MFA")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "ranked");
    await waitFor(() => {
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
    });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByRole("link", { name: "Arena alt" })).toBeInTheDocument();
    expect(calls).toContainEqual({
      cmd: "account_list",
      args: { filter: { ...EMPTY_FILTER, text: "ranked" }, sort: DEFAULT_SORT },
    });
  });

  it("shows how to add the first account when the vault is empty", async () => {
    await renderApp("/accounts", withAccounts({}, []));
    expect(await screen.findByRole("heading", { name: "No accounts yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first account" })).toHaveAttribute("href", "/accounts/new");
  });

  it("the Archived page lists archived accounts only", async () => {
    const { calls } = await renderApp("/archived", withAccounts());
    expect(await screen.findByRole("heading", { name: "Nothing archived" })).toBeInTheDocument();
    expect(calls).toContainEqual({
      cmd: "account_list",
      args: { filter: { ...EMPTY_FILTER, archived: true }, sort: DEFAULT_SORT },
    });
  });

  it("a demo vault says so above its sample accounts", async () => {
    await renderApp(
      "/accounts",
      withAccounts({ vault_status: () => ({ state: "unlocked", vault: { ...TEST_VAULT, demo: true } }) }),
    );
    expect(await screen.findByText(/These sample accounts use reserved example domains/)).toBeInTheDocument();
  });

  it("starred accounts appear in the sidebar in the order they were starred", async () => {
    await renderApp(
      "/accounts",
      withAccounts({}, [
        summary({ id: "a1", title: "Alpha", favorite: true, favoritedAt: "2026-09-22T10:00:00Z" }),
        summary({ id: "a2", title: "Bravo", favorite: true, favoritedAt: "2026-09-21T10:00:00Z" }),
        summary({ id: "a3", title: "Charlie" }),
      ]),
    );
    const group = await screen.findByRole("group", { name: "Favorites" });
    await waitFor(() => {
      expect(within(group).getAllByRole("link").map((l) => l.textContent)).toEqual(["BravoMain", "AlphaMain"]);
    });
    expect(within(group).getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", "/accounts/a1");
  });

  it("a data command that finds the vault locked sends the app back to the lock screen", async () => {
    vi.mocked(reloadWebview).mockClear();
    await renderApp("/accounts", {
      handlers: {
        account_list: () => {
          throw { code: "vault_locked", message: "The vault is locked." };
        },
      },
    });
    await waitFor(() => {
      expect(reloadWebview).toHaveBeenCalled();
    });
  });
});

describe("account detail", () => {
  it("shows the email when hiding is off", async () => {
    await renderApp("/accounts/a1", withAccounts());
    expect(await screen.findByText("nightowl@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show email" })).not.toBeInTheDocument();
  });

  it("masks email and recovery email until shown, then hides them again", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/accounts/a1",
      withAccounts({
        session_config_get: () => ({ ...DEFAULT_SESSION_CONFIG, hideEmails: true, revealHideSecs: 1 }),
        account_get: () => ({ ...DETAIL, recoveryEmail: "recover@example.com" }),
      }),
    );
    expect(await screen.findByRole("button", { name: "Show email" })).toBeInTheDocument();
    expect(screen.queryByText("nightowl@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("recover@example.com")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show email" }));
    expect(await screen.findByText("nightowl@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show recovery email" }));
    expect(screen.getByText("recover@example.com")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText("nightowl@example.com")).not.toBeInTheDocument();
        expect(screen.queryByText("recover@example.com")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });


  it("keeps the password hidden, reveals it on request and hides it again", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({
        session_config_get: () => ({ ...DEFAULT_SESSION_CONFIG, revealHideSecs: 1 }),
        secret_reveal: () => ({ value: "correct horse 42" }),
      }),
    );
    const show = await screen.findByRole("button", { name: "Show password" });
    expect(screen.queryByText("correct horse 42")).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "secret_reveal")).toBe(false);

    await user.click(show);
    expect(await screen.findByText("correct horse 42")).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "secret_reveal", args: { target: { kind: "accountPassword", id: "a1" } } });

    await waitFor(
      () => {
        expect(screen.queryByText("correct horse 42")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("copies the password inside Rust without ever asking for its value", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({ clipboard_copy_secret: () => ({ clearAfterSecs: 30 }) }),
    );
    await user.click(await screen.findByRole("button", { name: "Copy password" }));
    expect(calls).toContainEqual({ cmd: "clipboard_copy_secret", args: { target: { kind: "accountPassword", id: "a1" } } });
    expect(calls.some((c) => c.cmd === "secret_reveal")).toBe(false);
    await waitFor(() => {
      expect(document.querySelector('[data-toast-id="clipboard"]')).toHaveTextContent("Password copied");
    });
  });

  it("sends a hand copy of a shown password through Rust, like the Copy button", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({
        secret_reveal: () => ({ value: "correct horse 42" }),
        clipboard_copy_secret: () => ({ clearAfterSecs: 30 }),
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Show password" }));
    const shown = await screen.findByText("correct horse 42");

    // Select part of the value and copy: the webview's own copy is stopped ...
    const text = shown.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(fireEvent.copy(shown)).toBe(false);
    // ... and Rust copies the whole value, with the usual countdown.
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "clipboard_copy_secret",
        args: { target: { kind: "accountPassword", id: "a1" } },
      });
    });
    await waitFor(() => {
      expect(document.querySelector('[data-toast-id="clipboard"]')).toHaveTextContent("Password copied");
    });

    // Dragging the selection out of the window is stopped too.
    expect(fireEvent.dragStart(shown)).toBe(false);

    // Cut is treated the same.
    const before = calls.filter((c) => c.cmd === "clipboard_copy_secret").length;
    expect(fireEvent.cut(shown)).toBe(false);
    await waitFor(() => {
      expect(calls.filter((c) => c.cmd === "clipboard_copy_secret")).toHaveLength(before + 1);
    });
  });

  it("copies nothing when a selection runs past a shown secret, and leaves other text alone", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({
        secret_reveal: () => ({ value: "correct horse 42" }),
        clipboard_copy_secret: () => ({ clearAfterSecs: 30 }),
      }),
    );
    // Nothing shown yet: an ordinary copy is not interfered with.
    const notes = await screen.findByText("Main library");
    window.getSelection()?.selectAllChildren(notes);
    expect(fireEvent.copy(notes)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Show password" }));
    await screen.findByText("correct horse 42");
    // Text that isn't a secret still copies normally while one is shown.
    window.getSelection()?.selectAllChildren(notes);
    expect(fireEvent.copy(notes)).toBe(true);

    // Select all: the secret would ride along, so the copy is refused.
    window.getSelection()?.selectAllChildren(document.body);
    expect(fireEvent.copy(document.body)).toBe(false);
    await waitFor(() => {
      expect(document.querySelector('[data-toast-id="clipboard"]')).toHaveTextContent("Nothing was copied");
    });
    expect(calls.some((c) => c.cmd === "clipboard_copy_secret")).toBe(false);
  });

  it("forgets a revealed value when the page is left", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp(
      "/accounts/a1",
      withAccounts({ secret_reveal: () => ({ value: "correct horse 42" }) }),
    );
    await user.click(await screen.findByRole("button", { name: "Show password" }));
    await screen.findByText("correct horse 42");
    await router.navigate({ to: PAGE_PATHS.accounts });
    await router.navigate({ to: "/accounts/$accountId", params: { accountId: "a1" } });
    await screen.findByRole("button", { name: "Show password" });
    expect(screen.queryByText("correct horse 42")).not.toBeInTheDocument();
  });

  it("stars and unstars the account", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({ account_set_favorite: (a) => ({ ...DETAIL, favorite: a.favorite as boolean }) }),
    );
    await user.click(await screen.findByRole("button", { name: "Add to favorites" }));
    expect(calls).toContainEqual({ cmd: "account_set_favorite", args: { id: "a1", favorite: true } });
    expect(await screen.findByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
  });

  it("delete needs the account name typed exactly", async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderApp("/accounts/a1", withAccounts({ account_delete: () => null }));
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this account permanently?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByLabelText("Type “Game store (main)” to confirm");
    await user.type(input, "game store (main)");
    expect(confirm).toBeDisabled();
    expect(calls.some((c) => c.cmd === "account_delete")).toBe(false);

    await user.clear(input);
    await user.type(input, "Game store (main)");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(calls).toContainEqual({ cmd: "account_delete", args: { id: "a1", confirmTitle: "Game store (main)" } });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts");
    });
  });

  it("shows where a login link goes before opening it", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({
        account_url_target: () => ({ url: "https://store.example.com/login", host: "store.example.com" }),
        account_open_url: () => null,
      }),
    );
    await screen.findByRole("heading", { name: "Sign-in" });
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Open the login page?" });
    expect(await within(dialog).findByText("store.example.com")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "account_open_url")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Open store.example.com" }));
    expect(calls).toContainEqual({ cmd: "account_open_url", args: { id: "a1", which: "login" } });
  });

  it("marks a backup code used", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts/a1", withAccounts({ mfa_mark_code_used: () => DETAIL }));
    expect(await screen.findByText("2 of 3 left")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Backup codes" });
    const buttons = within(dialog).getAllByRole("button", { name: "Mark used" });
    await user.click(buttons[0] as HTMLElement);
    expect(calls).toContainEqual({ cmd: "mfa_mark_code_used", args: { id: "m1", index: 0, used: true } });
    expect(within(dialog).getByRole("button", { name: "Mark unused" })).toBeInTheDocument();
  });

  it("shows a backup code on request and hides it again after the reveal time", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({
        session_config_get: () => ({ ...DEFAULT_SESSION_CONFIG, revealHideSecs: 1 }),
        secret_reveal: () => ({ value: "ABCD-1234" }),
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Backup codes" });
    expect(calls.some((c) => c.cmd === "secret_reveal")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Show code 1" }));
    expect(await within(dialog).findByText("ABCD-1234")).toBeInTheDocument();
    expect(calls).toContainEqual({
      cmd: "secret_reveal",
      args: { target: { kind: "backupCode", id: "m1", index: 0 } },
    });

    await waitFor(
      () => {
        expect(within(dialog).queryByText("ABCD-1234")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(within(dialog).getByRole("button", { name: "Show code 1" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the current TOTP code with its countdown", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts/a1",
      withAccounts({ totp_current_code: () => ({ code: "123456", secondsRemaining: 17, period: 30 }) }),
    );
    await user.click(await screen.findByRole("button", { name: "Show code" }));
    expect(await screen.findByText("123 456")).toBeInTheDocument();
    expect(screen.getByText("changes in 17s")).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "totp_current_code", args: { id: "m1" } });
  });
});

describe("account form", () => {
  it("requires a name before calling Rust, then creates the account", async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderApp(
      "/accounts/new",
      withAccounts({ account_create: () => DETAIL }),
    );
    await user.click(await screen.findByRole("button", { name: "Add account" }));
    const name = screen.getByLabelText("Name");
    expect(await screen.findByText("Enter a name for this account.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
    expect(calls.some((c) => c.cmd === "account_create")).toBe(false);

    await user.type(name, "Game store (main)");
    await user.type(screen.getByLabelText("Username"), "nightowl");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.type(screen.getByLabelText("Tags"), "pc,");
    await user.click(screen.getByRole("button", { name: "Add account" }));

    const create = calls.find((c) => c.cmd === "account_create");
    expect(create?.args.input).toMatchObject({
      title: "Game store (main)",
      purposeId: "builtin-main",
      username: "nightowl",
      email: null,
      password: { op: "set", value: "correct horse 42" },
      sensitiveNotes: { op: "unchanged" },
      tags: ["pc"],
      customFields: [],
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts/a1");
    });
  });

  it("puts Rust's field errors on the right field", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/accounts/new",
      withAccounts({
        account_create: () => {
          throw { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "loginUrl" };
        },
      }),
    );
    await user.type(await screen.findByLabelText("Name"), "Store");
    await user.type(screen.getByLabelText("Login page"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText("Enter a web address that starts with https:// or http://.")).toBeInTheDocument();
    expect(screen.getByLabelText("Login page")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Login page")).toHaveFocus();
  });

  it("leaves a saved password alone when it isn't touched", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts/a1/edit", withAccounts({ account_update: () => DETAIL }));
    expect(await screen.findByText("A password is saved and hidden.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "secret_reveal")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const update = calls.find((c) => c.cmd === "account_update");
    expect(update?.args).toMatchObject({ id: "a1", input: { password: { op: "unchanged" }, title: "Game store (main)" } });
  });

  it("removes a saved password only when asked, with an undo before saving", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts/a1/edit", withAccounts({ account_update: () => DETAIL }));
    await screen.findByText("A password is saved and hidden.");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("The saved password will be removed when you save.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const update = calls.find((c) => c.cmd === "account_update");
    expect(update?.args).toMatchObject({ input: { password: { op: "clear" } } });
  });
});

describe("accessibility", () => {
  it.each([
    ["the account list", "/accounts", "table"],
    ["the account detail", "/accounts/a1", "Sign-in"],
    ["the account form", "/accounts/new", "Add account"],
  ])("%s has no axe violations", async (_name, path, ready) => {
    const { container } = await renderApp(path, withAccounts({}, [summary(), summary({ id: "a2", title: "Arena alt" })]));
    if (ready === "table") await screen.findByRole("table");
    else await screen.findByText(ready);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("status from activity", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const at = (days: number, over: Partial<AccountSummary> = {}) =>
    displayStatus({ status: "active", archivedAt: null, lastActivityAt: daysAgo(days), ...over }, now);

  it("turns an active account Stale, then Dormant, with no activity", () => {
    expect(at(0)).toEqual({ label: "Active", badge: "secure", activity: "Active today" });
    expect(at(3)).toMatchObject({ label: "Active", activity: "Last activity 3 days ago" });
    expect(at(STALE_AFTER_DAYS - 1).label).toBe("Active");
    expect(at(STALE_AFTER_DAYS)).toEqual({
      label: "Stale",
      badge: "attention",
      activity: `No activity for ${String(STALE_AFTER_DAYS)} days`,
    });
    expect(at(DORMANT_AFTER_DAYS - 1).label).toBe("Stale");
    expect(at(DORMANT_AFTER_DAYS)).toMatchObject({ label: "Dormant", badge: "dormant" });
  });

  it("keeps a status the user set, and an archived account's", () => {
    expect(at(200, { status: "locked" })).toMatchObject({ label: "Locked", badge: "warning" });
    expect(at(0, { status: "retired" }).label).toBe("Retired");
    expect(at(200, { archivedAt: daysAgo(1) }).label).toBe("Active");
  });
});

describe("quick copy in the account list", () => {
  it("replaces the Updated column and copies without opening the account", async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderApp(
      "/accounts",
      withAccounts({ clipboard_copy_secret: () => ({ clearAfterSecs: 30 }) }, [
        summary(),
        summary({ id: "a2", title: "Mail only", username: null, hasPassword: false }),
        summary({ id: "a3", title: "Nothing", username: null, email: null, hasPassword: false }),
      ]),
    );
    const table = await screen.findByRole("table", { name: "All Accounts" });
    expect(within(table).queryByRole("columnheader", { name: "Updated" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Quick copy" })).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: "Copy username for Game store (main)" }));
    expect(calls).toContainEqual({ cmd: "clipboard_copy_plain", args: { text: "nightowl" } });
    await user.click(within(table).getByRole("button", { name: "Copy password for Game store (main)" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "clipboard_copy_secret", args: { target: { kind: "accountPassword", id: "a1" } } });
    });
    expect(router.state.location.pathname).toBe("/accounts");

    // No username: the email is offered. Nothing to copy: no buttons.
    expect(within(table).getByRole("button", { name: "Copy email for Mail only" })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Copy password for Mail only" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /for Nothing$/ })).not.toBeInTheDocument();
  });

  it("shows the activity under the status", async () => {
    await renderApp("/accounts", withAccounts({}, [summary()]));
    const table = await screen.findByRole("table", { name: "All Accounts" });
    expect(within(table).getByText("Active today")).toBeInTheDocument();
  });
});
