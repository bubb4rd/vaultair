import { describe, expect, it } from "vitest";
import type { EdgeKind, Graph, GraphEdge, GraphNode, NodeKind } from "@/ipc/client";
import { LOOP_ROOM, NODE_HEIGHT, NODE_WIDTH, mapGraph, treeSize, type TreeItem } from "./graphMapper";

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

function edge(source: string, kind: EdgeKind, target: string): GraphEdge {
  return { id: `${source}>${kind}>${target}`, source, target, kind };
}

/** The product spec's example, as Rust returns it for the identity. */
function specGraph(): Graph {
  const me = "identity:i1";
  const email = "email:c1";
  const battleNet = "account:a1";
  const cod = "account:a2";
  return {
    focus: me,
    truncated: false,
    nodes: [
      node("identity", "i1", "Primary Gaming Identity", 0),
      node("email", "c1", "primary@example.com", 1, me, "primary_email"),
      node("email", "c2", "recovery@example.com", 1, me, "recovery_email"),
      node("account", "a1", "Battle.net", 1, email, "login_email"),
      node("account", "a2", "Call of Duty Main", 1, battleNet, "linked_launcher"),
      node("account", "a3", "Discord", 1, email, "login_email"),
      node("platform", "p1", "Battle.net", 2, battleNet, "on_platform"),
      node("game", "g1", "Call of Duty", 2, cod, "plays"),
      node("mfa_method", "m1", "Authenticator app", 2, battleNet, "mfa"),
    ],
    edges: [
      edge(me, "primary_email", email),
      edge(me, "recovery_email", "email:c2"),
      edge(me, "owns", battleNet),
      edge(me, "owns", cod),
      edge(me, "owns", "account:a3"),
      edge(email, "login_email", battleNet),
      edge(email, "login_email", cod),
      edge(email, "login_email", "account:a3"),
      edge("email:c2", "recovery_email", "account:a3"),
      edge(battleNet, "linked_launcher", cod),
      edge(battleNet, "on_platform", "platform:p1"),
      edge(cod, "plays", "game:g1"),
      edge(battleNet, "mfa", "mfa_method:m1"),
    ],
  };
}

function outline(item: TreeItem, depth = 0): string[] {
  const line = `${"  ".repeat(depth)}${item.edge ?? "focus"} ${item.node.label}`;
  return [line, ...item.children.flatMap((c) => outline(c, depth + 1))];
}

describe("mapGraph", () => {
  it("nests the spec's example the way the spec draws it", () => {
    const { tree } = mapGraph(specGraph());
    expect(tree && outline(tree)).toEqual([
      "focus Primary Gaming Identity",
      "  primary_email primary@example.com",
      "    login_email Battle.net",
      "      linked_launcher Call of Duty Main",
      "        plays Call of Duty",
      "      on_platform Battle.net",
      "      mfa Authenticator app",
      "    login_email Discord",
      "  recovery_email recovery@example.com",
    ]);
    expect(treeSize(tree)).toBe(9);
  });

  it("shows every relationship once in each view, apart from assignments the nesting already says", () => {
    const graph = specGraph();
    const { edges, tree } = mapGraph(graph);
    // Three "assigned" links are implied (identity, its email, the account).
    expect(edges.flatMap((e) => e.kinds)).not.toContain("owns");
    expect(edges.reduce((n, e) => n + e.kinds.length, 0)).toBe(graph.edges.length - 3);

    const also = (item: TreeItem): string[] => [
      ...item.also.map((l) => `${item.node.label}: ${l.kind} ${l.other.label}`),
      ...item.children.flatMap(also),
    ];
    expect(tree && also(tree)).toEqual([
      "Call of Duty Main: login_email primary@example.com",
      "Discord: recovery_email recovery@example.com",
    ]);
    // Nesting (8) plus the "also" lines (2) is every line on the canvas.
    expect(treeSize(tree) - 1 + 2).toBe(edges.reduce((n, e) => n + e.kinds.length, 0));
  });

  it("keeps an assignment the nesting doesn't say", () => {
    const graph = specGraph();
    // A second identity owns Discord without naming its email.
    graph.nodes.push(node("identity", "i2", "Creator", 2, "account:a3", "owns"));
    graph.edges.push(edge("identity:i2", "owns", "account:a3"));
    const { edges, tree } = mapGraph(graph);
    expect(edges.filter((e) => e.kinds.includes("owns"))).toHaveLength(1);
    expect(tree && outline(tree)).toContain("      owns Creator");
  });

  it("lays the focus out at the left with nothing overlapping, and draws lines left to right", () => {
    const { nodes, edges } = mapGraph(specGraph());
    const at = new Map(nodes.map((n) => [n.node.id, n]));
    const focus = nodes.find((n) => n.focus);
    expect(focus?.node.id).toBe("identity:i1");
    for (const n of nodes) {
      if (!n.focus) expect(n.x).toBeGreaterThan(focus?.x ?? 0);
      for (const other of nodes) {
        if (other === n) continue;
        const apart = Math.abs(n.x - other.x) >= NODE_WIDTH || Math.abs(n.y - other.y) >= NODE_HEIGHT;
        expect(apart, `${n.node.id} overlaps ${other.node.id}`).toBe(true);
      }
    }
    for (const e of edges) {
      expect(at.get(e.source)?.x).toBeLessThanOrEqual(at.get(e.target)?.x ?? 0);
    }
  });

  it("sizes the drawing to hold every node, and a looping line when two linked nodes share a column", () => {
    const plain = mapGraph(specGraph());
    for (const n of plain.nodes) {
      expect(n.x + NODE_WIDTH).toBeLessThan(plain.width);
      expect(n.y + NODE_HEIGHT).toBeLessThan(plain.height);
    }
    const graph = specGraph();
    // Discord also recovers through an email in its own column.
    graph.nodes.push(node("email", "c3", "other@example.com", 2, "account:a1", "recovery_email"));
    graph.edges.push(edge("email:c3", "recovery_email", "account:a1"), edge("email:c3", "recovery_email", "account:a2"));
    const looped = mapGraph(graph);
    const right = Math.max(...looped.nodes.map((n) => n.x + NODE_WIDTH));
    expect(looped.width - right).toBeGreaterThanOrEqual(LOOP_ROOM);
    expect(plain.width - Math.max(...plain.nodes.map((n) => n.x + NODE_WIDTH))).toBeLessThan(LOOP_ROOM);
  });

  it("merges two relationships between the same pair into one labelled line", () => {
    const graph = specGraph();
    graph.edges.push(edge("email:c1", "recovery_email", "account:a3"));
    const line = mapGraph(graph).edges.find((e) => e.source === "email:c1" && e.target === "account:a3");
    expect(line?.kinds).toEqual(["login_email", "recovery_email"]);
    expect(line?.label).toBe("Sign-in email, Recovery email");
    expect(line?.family).toBe("sign_in");
  });

  it("handles a lone focus and an empty graph", () => {
    const lone: Graph = { focus: "game:g1", truncated: false, nodes: [node("game", "g1", "Chess", 0)], edges: [] };
    const mapped = mapGraph(lone);
    expect(mapped.nodes).toHaveLength(1);
    expect(mapped.edges).toEqual([]);
    expect(mapped.tree?.children).toEqual([]);
    expect(mapGraph({ focus: "game:gone", truncated: false, nodes: [], edges: [] }).tree).toBeNull();
  });
});
