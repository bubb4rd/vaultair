import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AccountSummary,
  ContactPointView,
  EdgeKind,
  GameView,
  Graph,
  GraphNode,
  IdentityRef,
  NodeKind,
  PlatformView,
} from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { DEFAULT_SESSION_CONFIG, renderApp, type RenderOptions } from "@/test/render";
import { NodeMark } from "./NodeCard";
import { resetMapState } from "./useMapFocus";

function node(
  kind: NodeKind,
  id: string,
  label: string,
  depth: number,
  parent: string | null = null,
  parentEdge: EdgeKind | null = null,
): GraphNode {
  return { id: `${kind}:${id}`, kind, recordId: id, label, detail: null, icon: null, color: null, depth, parent, parentEdge };
}

const ME = "identity:i1";
const EMAIL = "email:c1";
const BATTLE_NET = "account:a1";

function graph(over: Partial<Graph> = {}): Graph {
  const edge = (source: string, kind: EdgeKind, target: string) => ({
    id: `${source}>${kind}>${target}`,
    source,
    target,
    kind,
  });
  return {
    focus: ME,
    truncated: false,
    nodes: [
      node("identity", "i1", "Primary Gaming Identity", 0),
      node("email", "c1", "primary@example.com", 1, ME, "primary_email"),
      { ...node("account", "a1", "Battle.net", 1, EMAIL, "login_email"), detail: "Main" },
      node("account", "a2", "Call of Duty Main", 1, BATTLE_NET, "linked_launcher"),
      node("platform", "p1", "Battle.net", 2, BATTLE_NET, "on_platform"),
      { ...node("mfa_method", "m1", "Authenticator app", 2, BATTLE_NET, "mfa"), recordId: "a1" },
    ],
    edges: [
      edge(ME, "primary_email", EMAIL),
      edge(ME, "owns", BATTLE_NET),
      edge(ME, "owns", "account:a2"),
      edge(EMAIL, "login_email", BATTLE_NET),
      edge(EMAIL, "login_email", "account:a2"),
      edge(BATTLE_NET, "linked_launcher", "account:a2"),
      edge(BATTLE_NET, "on_platform", "platform:p1"),
      edge(BATTLE_NET, "mfa", "mfa_method:m1"),
    ],
    ...over,
  };
}

const contact: ContactPointView = {
  id: "c1",
  kind: "email",
  value: "primary@example.com",
  label: null,
  identityId: "i1",
  accountCount: 2,
};

function handlers(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      identity_refs: () => [{ id: "i1", name: "Primary Gaming Identity", color: null }] as IdentityRef[],
      account_list: () => [] as AccountSummary[],
      contact_point_list: () => [contact],
      platform_list: () => [] as PlatformView[],
      game_list: () => [] as GameView[],
      graph_query: () => graph(),
      ...extra,
    },
  };
}

async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "List" }));
  return screen.findByRole("list", { name: "Relationships" });
}

describe("relationship map", () => {
  beforeEach(() => {
    resetMapState();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Rust for the first identity and draws the map with its legend", async () => {
    const { calls } = await renderApp("/map", handlers());
    expect(await screen.findByRole("group", { name: "Relationship map" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Map" })).toBeChecked();
    const legend = within(screen.getByRole("list", { name: "Line styles" }));
    expect(legend.getAllByRole("listitem")).toHaveLength(5);
    expect(legend.getByText("Suggested, not in vault")).toBeInTheDocument();
    expect(calls).toContainEqual({
      cmd: "graph_query",
      args: { focus: { kind: "identity", id: "i1" }, depth: null, limit: null },
    });
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveTextContent("Primary Gaming Identity");
    expect(screen.getByRole("radio", { name: "Focused" })).toBeChecked();
  });

  it("draws every record as a button with its relationship written beside it, and opens one", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/map", handlers());
    const map = await screen.findByRole("group", { name: "Relationship map" });
    expect(within(map).getByRole("button", { name: "Open Primary Gaming Identity, Identity" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    for (const name of [
      "Focus the map on primary@example.com, Email",
      "Open Call of Duty Main, Account",
      "Focus the map on Battle.net, Platform",
      "Open Authenticator app, MFA method",
      "Zoom in",
      "Zoom out",
      "Fit to window",
    ]) {
      expect(within(map).getByRole("button", { name })).toBeInTheDocument();
    }
    // Five links are drawn; the three assignments the nesting implies are not.
    const labels = Array.from(map.querySelectorAll(".map-edge-label"), (l) => l.textContent);
    expect(labels.sort()).toEqual(["Linked launcher", "MFA", "Platform", "Primary email", "Sign-in email", "Sign-in email"]);
    expect(map.querySelectorAll("path.map-edge")).toHaveLength(6);

    await user.click(within(map).getByRole("button", { name: "Open Battle.net, Account, Main" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts/a1");
    });
  });

  it("shows the same data as a list, nested, with each relationship written out", async () => {
    const user = userEvent.setup();
    await renderApp("/map", handlers());
    const list = await openList(user);
    expect(screen.queryByRole("group", { name: "Relationship map" })).not.toBeInTheDocument();

    const email = within(list).getByRole("button", { name: "Focus the map on primary@example.com" });
    const emailRow = email.closest("li") as HTMLElement;
    expect(within(emailRow).getAllByText("Primary email")[0]).toBeInTheDocument();
    const account = within(emailRow).getByRole("link", { name: "Battle.net" });
    const accountRow = account.closest("li") as HTMLElement;
    expect(within(accountRow).getByText("Account, Main")).toBeInTheDocument();
    // The linked account hangs under its launcher, and its other link is written out.
    expect(within(accountRow).getByRole("link", { name: "Call of Duty Main" })).toBeInTheDocument();
    expect(within(accountRow).getByText("Linked launcher")).toBeInTheDocument();
    expect(
      within(within(accountRow).getByRole("list", { name: "Other links of Call of Duty Main" })).getByRole("listitem"),
    ).toHaveTextContent("Sign-in email: primary@example.com");
    expect(within(accountRow).getByRole("link", { name: "Authenticator app" })).toHaveAttribute(
      "href",
      expect.stringContaining("/accounts/a1#mfa-heading"),
    );
    expect(await axeViolations(list)).toEqual([]);
  });

  it("reaches every record in the list by keyboard and opens one", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/map", handlers({ account_get: () => { throw new Error("not needed"); } }));
    const list = await openList(user);
    const reached = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await user.tab();
      const el = document.activeElement;
      if (el && list.contains(el)) reached.add(el.getAttribute("aria-label") ?? el.textContent);
    }
    for (const name of [
      "Primary Gaming Identity",
      "Focus the map on primary@example.com",
      "Battle.net",
      "Focus the map on Battle.net",
      "Call of Duty Main",
      "Authenticator app",
    ]) {
      expect(reached).toContain(name);
    }

    await user.click(within(list).getByRole("link", { name: "Battle.net" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/accounts/a1");
    });
  });

  it("moves the map when an email is chosen, from the list or the picker", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/map", handlers());
    const list = await openList(user);
    await user.click(within(list).getByRole("button", { name: "Focus the map on primary@example.com" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "graph_query",
        args: { focus: { kind: "contact", id: "c1" }, depth: null, limit: null },
      });
    });
    const picker = screen.getByRole("combobox", { name: "Focus" });
    expect(picker).toHaveTextContent("primary@example.com");

    // The picker is the app's own list: grouped by kind, and it filters by name as you type.
    await user.click(picker);
    const choices = await screen.findByRole("dialog", { name: "Choose a focus" });
    expect(within(choices).getByText("Identities")).toBeInTheDocument();
    expect(within(choices).getByText("Emails")).toBeInTheDocument();
    await user.type(within(choices).getByPlaceholderText("Find a record"), "gaming");
    expect(within(choices).queryByRole("option", { name: "primary@example.com" })).not.toBeInTheDocument();
    await user.click(within(choices).getByRole("option", { name: "Primary Gaming Identity" }));
    expect(screen.queryByRole("dialog", { name: "Choose a focus" })).not.toBeInTheDocument();
    expect(picker).toHaveTextContent("Primary Gaming Identity");
  });

  it("switches to the whole vault as one map of several trees, and back by picking a record", async () => {
    const user = userEvent.setup();
    const base = graph();
    const whole: Graph = {
      ...base,
      focus: null,
      nodes: [
        ...base.nodes,
        node("email", "c2", "stray@example.com", 0),
        node("account", "a3", "Forum", 1, "email:c2", "login_email"),
      ],
      edges: [
        ...base.edges,
        { id: "email:c2>login_email>account:a3", source: "email:c2", target: "account:a3", kind: "login_email" },
      ],
    };
    const stray: ContactPointView = { ...contact, id: "c2", value: "stray@example.com", identityId: null, accountCount: 1 };
    const { calls } = await renderApp(
      "/map",
      handlers({ graph_overview: () => whole, contact_point_list: () => [contact, stray] }),
    );
    await user.click(await screen.findByRole("radio", { name: "All" }));
    const map = await screen.findByRole("group", { name: "Relationship map" });
    await within(map).findByRole("button", { name: "Open Forum, Account" });
    expect(calls).toContainEqual({ cmd: "graph_overview", args: { limit: null } });
    // Nothing is the focus, and there is no record to pick.
    expect(map.querySelector("[aria-current]")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Focus" })).not.toBeInTheDocument();

    const list = await openList(user);
    const tops = Array.from(list.children, (li) => li.querySelector("a, button")?.textContent);
    expect(tops).toEqual(["Primary Gaming Identity", "stray@example.com"]);
    expect(within(list).queryByText(/the focus/)).not.toBeInTheDocument();
    expect(await axeViolations(list)).toEqual([]);

    // Choosing a record from the whole map narrows to it.
    await user.click(within(list).getByRole("button", { name: "Focus the map on stray@example.com" }));
    expect(await screen.findByRole("radio", { name: "Focused" })).toBeChecked();
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: "graph_query",
        args: { focus: { kind: "contact", id: "c2" }, depth: null, limit: null },
      });
    });
  });

  it("opens in the list when the system asks for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    await renderApp("/map", handlers());
    expect(await screen.findByRole("list", { name: "Relationships" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
  });

  it("keeps emails masked when the privacy setting is on", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/map",
      handlers({ session_config_get: () => ({ ...DEFAULT_SESSION_CONFIG, hideEmails: true }) }),
    );
    const list = await openList(user);
    expect(within(list).getByRole("button", { name: "Focus the map on Hidden email 1" })).toBeInTheDocument();
    expect(screen.queryByText("primary@example.com", { exact: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Focus" }));
    expect(await screen.findByRole("option", { name: "Hidden email 1" })).toBeInTheDocument();
  });

  it("says when the map was cut short", async () => {
    const user = userEvent.setup();
    await renderApp("/map", handlers({ graph_query: () => graph({ truncated: true }) }));
    await openList(user);
    expect(screen.getByRole("status")).toHaveTextContent("Showing the nearest 6 records.");
  });

  it("explains an empty vault instead of asking for a map", async () => {
    const { calls } = await renderApp(
      "/map",
      handlers({ identity_refs: () => [], contact_point_list: () => [] }),
    );
    const empty = await screen.findByTestId("empty-state");
    expect(within(empty).getByRole("heading", { name: "Nothing to map yet" })).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "graph_query")).toBe(false);
  });

  describe("prospective accounts", () => {
    it("shows the provider's catalog mark from the on-screen address, and a plus otherwise", () => {
      const known = render(<NodeMark node={node("prospective_account", "c1", "owl@pm.me", 1)} label="owl@pm.me" />);
      expect(known.container.querySelector("[data-logo='protonmail']")).toBeTruthy();
      known.unmount();

      const hidden = render(
        <NodeMark node={node("prospective_account", "c1", "Hidden email 1", 1)} label="Hidden email 1" />,
      );
      expect(hidden.container.querySelector("[data-logo]")).toBeNull();
    });

    const PROSPECT = "prospective_account:c1";
    const NAME = "Review primary@example.com, Suggested account";

    /** Two accounts sign in with the address, and no email account in the vault does. */
    function withProspect(extra: RenderOptions["handlers"] = {}): RenderOptions {
      const base = graph();
      return handlers({
        graph_query: () => ({
          ...base,
          nodes: [...base.nodes, node("prospective_account", "c1", "primary@example.com", 2, EMAIL, "prospective")],
          edges: [...base.edges, { id: `${EMAIL}>prospective>${PROSPECT}`, source: EMAIL, target: PROSPECT, kind: "prospective" }],
        }),
        purpose_list: () => [
          { id: "builtin-main", slug: "main", name: "Main", isBuiltin: true, isHidden: false, color: null, accountCount: 0 },
        ],
        tag_list: () => [],
        ...extra,
      });
    }

    async function openPanel(user: ReturnType<typeof userEvent.setup>) {
      const map = await screen.findByRole("group", { name: "Relationship map" });
      await user.click(within(map).getByRole("button", { name: NAME }));
      return screen.findByRole("dialog", { name: "Suggested account for primary@example.com" });
    }

    it("draws the mailbox the vault lacks with its own line and adds it in one click", async () => {
      const user = userEvent.setup();
      const { calls } = await renderApp(
        "/map",
        withProspect({ account_create: () => ({ id: "a9", title: "example.com" }) }),
      );
      const map = await screen.findByRole("group", { name: "Relationship map" });
      expect(map.querySelectorAll("path.map-edge-suggested")).toHaveLength(1);
      expect(Array.from(map.querySelectorAll(".map-edge-label"), (l) => l.textContent)).toContain("Mailbox");

      const panel = await openPanel(user);
      expect(panel).toHaveTextContent("2 accounts use this address, but the mailbox itself isn't in your vault.");
      await user.click(within(panel).getByRole("button", { name: "Add account" }));
      await waitFor(() => {
        expect(calls.find((c) => c.cmd === "account_create")?.args.input).toMatchObject({
          title: "example.com",
          accountType: "email",
          email: "primary@example.com",
          purposeId: "builtin-main",
          identityId: "i1",
          platformId: null,
          password: { op: "unchanged" },
        });
      });
      expect(await screen.findByText("Account added")).toBeInTheDocument();
    });

    it("discards the suggestion and brings it back with Undo", async () => {
      const user = userEvent.setup();
      const { calls } = await renderApp("/map", withProspect());
      const panel = await openPanel(user);
      await user.click(within(panel).getByRole("button", { name: "Discard" }));
      await waitFor(() => {
        expect(calls).toContainEqual({
          cmd: "graph_prospect_set_dismissed",
          args: { contactId: "c1", dismissed: true },
        });
      });
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await waitFor(() => {
        expect(calls).toContainEqual({
          cmd: "graph_prospect_set_dismissed",
          args: { contactId: "c1", dismissed: false },
        });
      });
    });

    it("opens the new-account form filled in for the mailbox", async () => {
      const user = userEvent.setup();
      const { router } = await renderApp("/map", withProspect());
      const panel = await openPanel(user);
      await user.click(within(panel).getByRole("button", { name: "Edit first" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/accounts/new");
      });
      expect(router.state.location.search).toEqual({ mailbox: "c1" });
      expect(await screen.findByDisplayValue("primary@example.com")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("example.com");
    });

    it("offers the same three actions in the list, and masks the address when emails are hidden", async () => {
      const user = userEvent.setup();
      const { calls } = await renderApp(
        "/map",
        withProspect({ session_config_get: () => ({ ...DEFAULT_SESSION_CONFIG, hideEmails: true }) }),
      );
      const list = await openList(user);
      for (const name of [
        "Add Hidden email 1 as an account",
        "Edit Hidden email 1 before adding it",
        "Discard the suggestion for Hidden email 1",
      ]) {
        expect(within(list).getByRole("button", { name })).toBeInTheDocument();
      }
      expect(within(list).getByText("Suggested account")).toBeInTheDocument();
      expect(screen.queryByText("primary@example.com", { exact: false })).not.toBeInTheDocument();
      expect(await axeViolations(list)).toEqual([]);

      await user.click(within(list).getByRole("button", { name: "Discard the suggestion for Hidden email 1" }));
      await waitFor(() => {
        expect(calls.some((c) => c.cmd === "graph_prospect_set_dismissed")).toBe(true);
      });
      // The toast names it the way the map does.
      expect(await screen.findByText("Suggestion discarded")).toBeInTheDocument();
      expect(screen.queryByText("primary@example.com", { exact: false })).not.toBeInTheDocument();
    });
  });

  it("says so when the map can't be loaded", async () => {
    await renderApp(
      "/map",
      handlers({
        graph_query: () => {
          throw { code: "internal", message: "Something went wrong. Your vault was not changed." };
        },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Couldn't load the relationship map" })).toBeInTheDocument();
  });
});
