import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
    expect(within(screen.getByRole("list", { name: "Line styles" })).getAllByRole("listitem")).toHaveLength(4);
    expect(calls).toContainEqual({
      cmd: "graph_query",
      args: { focus: { kind: "identity", id: "i1" }, depth: null, limit: null },
    });
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("identity:i1");
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
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("contact:c1");

    await user.selectOptions(screen.getByRole("combobox", { name: "Focus" }), "identity:i1");
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("identity:i1");
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
    expect(screen.getByRole("option", { name: "Hidden email 1" })).toBeInTheDocument();
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
