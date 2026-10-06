import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_SORT,
  EMPTY_FILTER,
  type AccountFilter,
  type AccountSummary,
  type PurposeView,
  type SavedView,
  type SearchHit,
} from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { renderApp, type RenderOptions } from "@/test/render";
import { FILTER_KINDS, activeChips, normalizeFilter, sameSpec, withoutChips, type FilterContext } from "./filters";

const PURPOSES: PurposeView[] = [
  { id: "builtin-main", slug: "main", name: "Main", isBuiltin: true, isHidden: false, color: null, accountCount: 0 },
  { id: "builtin-alt", slug: "alt", name: "Alt", isBuiltin: true, isHidden: false, color: null, accountCount: 0 },
];

const summary = (id: string, title: string, over: Partial<AccountSummary> = {}): AccountSummary => ({
  id,
  title,
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: `${title.toLowerCase()}_user`,
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
  backupCodesRemaining: 2,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: [],
  updatedAt: "2026-09-20T10:00:00Z",
  lastActivityAt: new Date().toISOString(),
  ...over,
});

const ACCOUNTS = [
  summary("a1", "Alpha", { tags: ["ranked"] }),
  summary("a2", "Bravo", { purposeId: "builtin-alt", purposeName: "Alt", mfaEnabled: false }),
  summary("a3", "Charlie"),
  summary("a4", "Delta", { tags: ["ranked"] }),
];

const MISSING_MFA: SavedView = {
  id: "builtin-view-missing-mfa",
  name: "Missing MFA",
  icon: "shield",
  isBuiltin: true,
  spec: { v: 1, filter: { ...EMPTY_FILTER, mfa: false } },
};

/** Stands in for Rust: archived side, purposes, MFA, text and sort direction. */
function list(a: Record<string, unknown>) {
  const f = a.filter as AccountFilter;
  if (f.archived) return [];
  return ACCOUNTS.filter(
    (x) =>
      (!f.purposeIds?.length || f.purposeIds.includes(x.purposeId)) &&
      (f.mfa === null || f.mfa === undefined || x.mfaEnabled === f.mfa) &&
      (!f.text || x.title.toLowerCase().includes(f.text.toLowerCase())),
  );
}

function options(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      account_list: list,
      purpose_list: () => PURPOSES,
      tag_list: () => ["ranked"],
      saved_view_list: () => [MISSING_MFA],
      ...extra,
    },
  };
}

const CTX: FilterContext = {
  identities: [{ id: "i1", name: "Main me", color: null }],
  purposes: PURPOSES,
  platforms: [],
  games: [],
  tags: ["ranked", "eu"],
  publishers: ["Riot Games"],
};

describe("filter chips", () => {
  it("every kind writes and reads back only its own field", () => {
    for (const kind of FILTER_KINDS) {
      const values = kind
        .options(CTX)
        .slice(0, kind.multi ? 2 : 1)
        .map((o) => o.value);
      if (values.length === 0) continue;
      const set = kind.set(EMPTY_FILTER, values);
      expect(kind.selected(set), kind.id).toEqual(values);
      expect(kind.selected(kind.set(set, [])), kind.id).toEqual([]);
      for (const other of FILTER_KINDS.filter((k) => k !== kind)) {
        expect(other.selected(set), `${kind.id} leaked into ${other.id}`).toEqual([]);
      }
    }
  });

  it("maps chips to the query object Rust receives", () => {
    const byId = (id: string) => {
      const kind = FILTER_KINDS.find((k) => k.id === id);
      if (!kind) throw new Error(id);
      return kind;
    };
    let f = byId("purpose").set(EMPTY_FILTER, ["builtin-main", "builtin-alt"]);
    f = byId("mfa").set(f, ["no"]);
    f = byId("notVerified").set(f, ["90"]);
    f = byId("highPriority").set(f, ["on"]);
    expect(f).toEqual({
      ...EMPTY_FILTER,
      purposeIds: ["builtin-main", "builtin-alt"],
      mfa: false,
      notVerifiedInDays: 90,
      highPriority: true,
    });
    expect(activeChips(f, CTX).map((c) => c.text)).toEqual([
      "Purpose: Main, Alt",
      "MFA: Off",
      "Not verified in: 90 days",
      "High-priority",
    ]);
    expect(withoutChips({ ...f, text: "owl" })).toEqual({ ...EMPTY_FILTER, text: "owl" });
  });

  it("compares with a saved view by value", () => {
    const spec = { v: 1, filter: { mfa: false } as AccountFilter };
    expect(sameSpec({ filter: { ...EMPTY_FILTER, mfa: false }, sort: DEFAULT_SORT }, spec)).toBe(true);
    expect(sameSpec({ filter: { ...EMPTY_FILTER, mfa: false, text: "  " }, sort: DEFAULT_SORT }, spec)).toBe(true);
    expect(sameSpec({ filter: { ...EMPTY_FILTER, mfa: true }, sort: DEFAULT_SORT }, spec)).toBe(false);
    expect(
      sameSpec({ filter: { ...EMPTY_FILTER, mfa: false }, sort: { key: "title", descending: true } }, spec),
    ).toBe(false);
    expect(normalizeFilter({ text: " x " }).text).toBe("x");
  });

  it("adding and removing a chip changes the query", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts", options());
    await screen.findByRole("table", { name: "All Accounts" });

    await user.click(screen.getByRole("button", { name: "Add filter" }));
    (await screen.findByRole("menuitem", { name: "Purpose" })).focus();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menuitemcheckbox", { name: "Main" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}{Escape}");
    await waitFor(() => {
      expect(screen.getByText("1 of 4")).toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      cmd: "account_list",
      args: { filter: { ...EMPTY_FILTER, purposeIds: ["builtin-alt"] }, sort: DEFAULT_SORT },
    });

    await user.click(await screen.findByRole("button", { name: "Remove filter: Purpose: Alt" }));
    await waitFor(() => {
      expect(screen.getByText("4 accounts")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Remove filter/ })).not.toBeInTheDocument();
  });
});

describe("selection and bulk actions", () => {
  it("shift-click selects a range, and the header box selects all", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts", options());
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Charlie" }));
    await user.keyboard("{/Shift}");
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Bravo" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Delta" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveProperty("indeterminate", true);

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(within(bar).getByText("4 selected")).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("bulk delete needs the exact phrase, and sends it to Rust", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts", options({ account_bulk_delete: () => ({ changed: 2 }) }));
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Delta" }));
    await user.click(screen.getByRole("button", { name: "Delete…" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete 2 accounts permanently?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete 2 accounts" });
    const input = within(dialog).getByLabelText("Type “DELETE 2 ACCOUNTS” to confirm");
    expect(confirm).toBeDisabled();
    await user.type(input, "delete 2 accounts");
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, "DELETE 2 ACCOUNTS");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "account_bulk_delete",
        args: { ids: ["a1", "a4"], confirm: "DELETE 2 ACCOUNTS" },
      });
    });
    expect((await screen.findAllByText("2 accounts deleted")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a stale selection fails the whole delete and says so", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/accounts",
      options({
        account_bulk_delete: () => {
          throw { code: "not_found", message: "Not found." };
        },
      }),
    );
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "DELETE 1 ACCOUNT");
    await user.click(within(dialog).getByRole("button", { name: "Delete 1 account" }));
    expect(await within(dialog).findByText(/Nothing was deleted/)).toBeInTheDocument();
  });

  it("tags and archives the selection", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/accounts",
      options({
        account_bulk_archive: () => ({ changed: 1 }),
        account_bulk_tag: () => ({ changed: 2 }),
      }),
    );
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Charlie" }));
    await user.click(screen.getByRole("button", { name: "Tag" }));
    await user.type(await screen.findByLabelText("Add tags"), "weekly, eu");
    await user.click(screen.getByRole("checkbox", { name: "ranked" }));
    await user.click(screen.getByRole("button", { name: "Apply to 2 accounts" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "account_bulk_tag",
        args: { ids: ["a1", "a3"], add: ["weekly", "eu"], remove: ["ranked"] },
      });
    });
    expect((await screen.findAllByText("Tags updated on 2 accounts")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "account_bulk_archive", args: { ids: ["a2"], archived: true } });
    });
  });
});

describe("views and layouts", () => {
  it("opens a built-in view and saves an edited one as a new view", async () => {
    const user = userEvent.setup();
    const created: SavedView = { ...MISSING_MFA, id: "v1", name: "No MFA alts", icon: null, isBuiltin: false };
    const { calls } = await renderApp("/accounts", options({ saved_view_create: () => created }));
    await screen.findByRole("table", { name: "All Accounts" });

    await user.click(screen.getByRole("button", { name: "Views" }));
    await user.click(await screen.findByRole("menuitem", { name: "Missing MFA" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Missing MFA" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("1 of 4")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Remove filter: MFA: Off" })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "bra");
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "account_list",
        args: { filter: { ...EMPTY_FILTER, mfa: false, text: "bra" }, sort: DEFAULT_SORT },
      });
    });
    await user.click(screen.getByRole("button", { name: "Views" }));
    await user.click(await screen.findByRole("menuitem", { name: "Save as new view…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as a view" });
    await user.type(within(dialog).getByLabelText("Name"), "No MFA alts");
    await user.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "saved_view_create",
        args: {
          input: {
            name: "No MFA alts",
            spec: { v: 1, filter: { ...EMPTY_FILTER, mfa: false, text: "bra" }, sort: DEFAULT_SORT },
          },
        },
      });
    });
  });

  it("switches between table, cards and compact", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts", options());
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("radio", { name: "Cards" }));
    expect(within(screen.getByRole("list", { name: "All Accounts" })).getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("radio", { name: "Compact" }));
    expect(within(screen.getByRole("list", { name: "All Accounts" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  });

  it("sorts by a column header", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts", options());
    await screen.findByRole("table", { name: "All Accounts" });
    const header = screen.getByRole("columnheader", { name: "Account" });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(header).getByRole("button"));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "account_list",
        args: { filter: EMPTY_FILTER, sort: { key: "title", descending: true } },
      });
    });
    expect(screen.getByRole("columnheader", { name: "Account" })).toHaveAttribute("aria-sort", "descending");
  });

  it("has no axe violations with a selection", async () => {
    const user = userEvent.setup();
    const { container } = await renderApp("/accounts", options());
    await screen.findByRole("table", { name: "All Accounts" });
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Ctrl+K search", () => {
  it("finds an account by a gamertag fragment and opens it", async () => {
    const user = userEvent.setup();
    const alpha = summary("a1", "Alpha");
    const hits: SearchHit[] = [
      { kind: "gameProfile", id: "gp1", gamertag: "xX_Sn1per", gameName: "Valorant", gameIcon: null, account: alpha },
      { kind: "identity", id: "i1", name: "Sniper persona", color: null, primaryEmail: null, archived: false },
    ];
    const { calls, router } = await renderApp("/", options({ search: (a) => (a.query === "sn1p" ? hits : []) }));
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "sn1p");
    expect(await within(dialog).findByText("xX_Sn1per")).toBeInTheDocument();
    expect(within(dialog).getByText("Valorant profile on Alpha")).toBeInTheDocument();
    expect(within(dialog).getByText("Sniper persona")).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "search", args: { query: "sn1p", limit: 20 } });
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts/a1");
    });
  });

  it("opens a saved view", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/", options());
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "missing");
    await user.click(await within(dialog).findByRole("option", { name: "Missing MFA" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Missing MFA" })).toBeInTheDocument();
  });
});
