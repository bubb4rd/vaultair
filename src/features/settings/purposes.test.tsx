import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_SORT,
  EMPTY_FILTER,
  type AccountDetail,
  type AccountSummary,
  type PurposeInput,
  type PurposeView,
} from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { renderApp, type RenderOptions } from "@/test/render";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

const label = (over: Partial<PurposeView>): PurposeView => ({
  id: "builtin-main",
  slug: "main",
  name: "Main",
  isBuiltin: true,
  isHidden: false,
  color: null,
  accountCount: 0,
  ...over,
});

const MAIN = label({ accountCount: 1 });
const ALT = label({ id: "builtin-alt", slug: "alt", name: "Alt" });
const TOURNAMENT = label({
  id: "p-tournament",
  slug: "tournament",
  name: "Tournament",
  isBuiltin: false,
  color: "amber",
  accountCount: 2,
});

const summary = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "a1",
  title: "LAN finals",
  accountType: "game",
  purposeId: TOURNAMENT.id,
  purposeName: "Tournament",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: null,
  platformId: null,
  platformName: null,
  platformIcon: null,
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  hasPassword: false,
  passwordStrength: null,
  mfaEnabled: true,
  backupCodesRemaining: 0,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: [],
  updatedAt: "2026-09-20T10:00:00Z",
  lastActivityAt: new Date().toISOString(),
  ...over,
});

const detail = (over: Partial<AccountDetail> = {}): AccountDetail => ({
  id: "a1",
  title: "LAN finals",
  accountType: "game",
  purposeId: TOURNAMENT.id,
  purposeName: "Tournament",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: null,
  recoveryEmail: null,
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
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
  lastActivityAt: new Date().toISOString(),
  tags: [],
  customFields: [],
  mfa: [],
  ...over,
});

/** Purpose commands backed by a small in-memory list, like Rust's. */
function store(initial: PurposeView[] = [MAIN, ALT, TOURNAMENT], extra: RenderOptions["handlers"] = {}): RenderOptions {
  let list = [...initial];
  const find = (id: unknown) => list.find((p) => p.id === id);
  // A fresh object per change, as a real IPC round trip gives.
  const change = (id: unknown, over: Partial<PurposeView>) => {
    list = list.map((p) => (p.id === id ? { ...p, ...over } : p));
    return find(id);
  };
  return {
    handlers: {
      purpose_list: () => list,
      purpose_create: (a) => {
        const input = a.input as PurposeInput;
        const made = label({
          id: "p-new",
          slug: input.name.toLowerCase(),
          name: input.name.trim(),
          isBuiltin: false,
          color: input.color,
        });
        list = [...list, made];
        return made;
      },
      purpose_update: (a) => {
        const input = a.input as PurposeInput;
        return change(a.id, { name: input.name, color: input.color });
      },
      purpose_set_hidden: (a) => change(a.id, { isHidden: Boolean(a.hidden) }),
      purpose_reorder: (a) => {
        list = (a.ids as string[]).map((id) => find(id)).filter((p): p is PurposeView => p !== undefined);
        return list;
      },
      purpose_delete: (a) => {
        list = list.filter((p) => p.id !== a.id);
        return null;
      },
      account_list: () => [summary()],
      account_get: () => detail(),
      tag_list: () => [],
      ...extra,
    },
  };
}

async function labels() {
  return screen.findByRole("list", { name: "Purpose labels" });
}

function rowNames() {
  return screen.getAllByTestId("purpose-row").map((r) => r.querySelector("p")?.textContent);
}

describe("purpose labels in settings", () => {
  it("lists every label with what it is, and only custom ones can be deleted", async () => {
    await renderApp("/settings", store([MAIN, label({ ...ALT, isHidden: true }), TOURNAMENT]));
    const list = await labels();
    expect(rowNames()).toEqual(["Main", "Alt", "Tournament"]);
    expect(within(list).getByText("Built-in · 1 account")).toBeInTheDocument();
    expect(within(list).getByText("Built-in · Hidden · 0 accounts")).toBeInTheDocument();
    expect(within(list).getByText("Custom · 2 accounts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Main" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Tournament" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Alt" })).toBeInTheDocument();
  });

  it("adds a custom label with a color", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store([MAIN, ALT]));
    await labels();
    await user.click(screen.getByRole("button", { name: "Add a label" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a purpose label" });
    await user.click(within(dialog).getByRole("button", { name: "Add label" }));
    expect(await within(dialog).findByText(/Enter a name no other label has/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "Tournament");
    await user.click(within(dialog).getByRole("radio", { name: "Amber" }));
    await user.click(within(dialog).getByRole("button", { name: "Add label" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "purpose_create", args: { input: { name: "Tournament", color: "amber" } } });
    });
    await waitFor(() => {
      expect(rowNames()).toEqual(["Main", "Alt", "Tournament"]);
    });
  });

  it("shows Rust's name clash next to the field", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/settings",
      store([MAIN], {
        purpose_create: () => {
          throw { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "name" };
        },
      }),
    );
    await labels();
    await user.click(screen.getByRole("button", { name: "Add a label" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a purpose label" });
    await user.type(within(dialog).getByLabelText("Name"), "main");
    await user.click(within(dialog).getByRole("button", { name: "Add label" }));
    const name = within(dialog).getByLabelText("Name");
    await waitFor(() => {
      expect(name).toHaveAttribute("aria-invalid", "true");
    });
    expect(name).toHaveAccessibleDescription(/no other label has/);
  });

  it("recolors a built-in but keeps its name", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store());
    await labels();
    await user.click(screen.getByRole("button", { name: "Edit Main" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Main" });
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveAccessibleDescription("Built-in labels keep their name.");
    await user.click(within(dialog).getByRole("radio", { name: "Teal" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "purpose_update",
        args: { id: "builtin-main", input: { name: "Main", color: "teal" } },
      });
    });
  });

  it("renames a custom label", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store());
    await labels();
    await user.click(screen.getByRole("button", { name: "Edit Tournament" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Tournament" });
    const name = within(dialog).getByLabelText("Name");
    expect(within(dialog).getByRole("radio", { name: "Amber" })).toBeChecked();
    await user.clear(name);
    await user.type(name, "Scrims");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "purpose_update",
        args: { id: TOURNAMENT.id, input: { name: "Scrims", color: "amber" } },
      });
    });
    expect(await screen.findByText("Scrims")).toBeInTheDocument();
  });

  it("reorders from the keyboard and keeps focus on the moved label", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store());
    await labels();
    expect(screen.getByRole("button", { name: "Move Main up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Tournament down" })).toBeDisabled();

    screen.getByRole("button", { name: "Move Alt up" }).focus();
    await user.keyboard("{Enter}");
    expect(rowNames()).toEqual(["Alt", "Main", "Tournament"]);
    expect(calls).toContainEqual({
      cmd: "purpose_reorder",
      args: { ids: ["builtin-alt", "builtin-main", TOURNAMENT.id] },
    });
    // Alt is now first, so its up arrow is disabled and focus moves to down.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move Alt down" })).toHaveFocus();
    });

    screen.getByRole("button", { name: "Move Main down" }).focus();
    await user.keyboard(" ");
    expect(rowNames()).toEqual(["Alt", "Tournament", "Main"]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move Main up" })).toHaveFocus();
    });
  });

  it("hides and shows a label, and never the last visible one", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store([MAIN, ALT]));
    await labels();
    await user.click(screen.getByRole("button", { name: "Hide Alt" }));
    expect(calls).toContainEqual({ cmd: "purpose_set_hidden", args: { id: "builtin-alt", hidden: true } });
    expect(await screen.findByRole("button", { name: "Show Alt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Main" })).toBeDisabled();
    expect(screen.getByText(/One label stays visible/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Alt" }));
    expect(calls).toContainEqual({ cmd: "purpose_set_hidden", args: { id: "builtin-alt", hidden: false } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide Main" })).toBeEnabled();
    });
  });

  it("deletes a used label only by moving its accounts to another visible one", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp(
      "/settings",
      store([MAIN, label({ ...ALT, isHidden: true }), label({ id: "builtin-casual", slug: "casual", name: "Casual" }), TOURNAMENT]),
    );
    await labels();
    await user.click(screen.getByRole("button", { name: "Delete Tournament" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Tournament?" });
    expect(within(dialog).getByText(/2 accounts use this label/)).toBeInTheDocument();
    const target = within(dialog).getByLabelText("Move its accounts to");
    // Hidden labels aren't offered as the new home.
    expect(within(target).getAllByRole("option").map((o) => o.textContent)).toEqual(["Main", "Casual"]);
    await user.selectOptions(target, "Casual");
    await user.click(within(dialog).getByRole("button", { name: "Delete label" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "purpose_delete", args: { id: TOURNAMENT.id, reassignTo: "builtin-casual" } });
    });
    await waitFor(() => {
      expect(rowNames()).toEqual(["Main", "Alt", "Casual"]);
    });
  });

  it("deletes an unused label without asking where accounts go", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", store([MAIN, label({ ...TOURNAMENT, accountCount: 0 })]));
    await labels();
    await user.click(screen.getByRole("button", { name: "Delete Tournament" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Tournament?" });
    expect(within(dialog).getByText(/No accounts use this label/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Move its accounts to")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete label" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "purpose_delete", args: { id: TOURNAMENT.id, reassignTo: null } });
    });
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/settings", store());
    await labels();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("custom and hidden purposes on accounts", () => {
  it("shows a custom label's color on the account list and filters by it", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts", store([MAIN, TOURNAMENT]));
    const table = await screen.findByRole("table", { name: "All Accounts" });
    const badge = within(table).getByText("Tournament").closest("[data-purpose-color]");
    await waitFor(() => {
      expect(badge).toHaveAttribute("data-purpose-color", "amber");
    });

    await user.click(screen.getByRole("button", { name: "Add filter" }));
    (await screen.findByRole("menuitem", { name: "Purpose" })).focus();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menuitemcheckbox", { name: "Main" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemcheckbox", { name: "Tournament" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "account_list",
        args: { filter: { ...EMPTY_FILTER, purposeIds: [TOURNAMENT.id] }, sort: DEFAULT_SORT },
      });
    });
  });

  it("offers a custom label on a new account, but not a hidden one", async () => {
    const user = userEvent.setup();
    const hiddenAlt = label({ ...ALT, isHidden: true });
    // Main hidden too: the form starts on the first visible label.
    const { calls } = await renderApp(
      "/accounts/new",
      store([label({ ...MAIN, isHidden: true }), hiddenAlt, TOURNAMENT], { account_create: () => detail() }),
    );
    const purpose = await screen.findByLabelText<HTMLSelectElement>("Purpose");
    expect(within(purpose).getAllByRole("option").map((o) => o.textContent)).toEqual(["Tournament"]);
    expect(purpose.value).toBe(TOURNAMENT.id);
    await user.type(screen.getByLabelText("Name"), "LAN finals");
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => {
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: "account_create",
          args: { input: expect.objectContaining({ purposeId: TOURNAMENT.id }) as unknown },
        }),
      );
    });
  });

  it("keeps a hidden purpose as the current value when editing an account that has it", async () => {
    const hidden = label({ ...TOURNAMENT, isHidden: true });
    await renderApp("/accounts/a1/edit", store([MAIN, ALT, hidden]));
    const purpose = await screen.findByLabelText<HTMLSelectElement>("Purpose");
    expect(purpose.value).toBe(TOURNAMENT.id);
    expect(within(purpose).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Main",
      "Alt",
      "Tournament (hidden)",
    ]);
  });

  it("still shows a hidden purpose on the account page", async () => {
    await renderApp("/accounts/a1", store([MAIN, label({ ...TOURNAMENT, isHidden: true })]));
    const chips = await screen.findByRole("list", { name: "At a glance" });
    const badge = within(chips).getByText("Tournament").closest("[data-purpose-color]");
    expect(badge).not.toBeNull();
    await waitFor(() => {
      expect(badge).toHaveAttribute("data-purpose-color", "amber");
    });
  });
});
