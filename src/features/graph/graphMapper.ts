import dagre from "@dagrejs/dagre";
import type { EdgeKind, Graph, GraphEdge, GraphNode } from "@/ipc/client";
import { edgeFamily, edgeLabel, type EdgeFamily } from "./labels";

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 52;
const MARGIN = 24;
/** Space to the right of the last column for a looping line and its label. */
export const LOOP_ROOM = 176;

/** A node and where its top-left corner goes on the canvas. */
export interface MapNode {
  node: GraphNode;
  x: number;
  y: number;
  focus: boolean;
}

/** Every relationship between two nodes, drawn as one labelled line from the left node to the right one. */
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kinds: EdgeKind[];
  label: string;
  family: EdgeFamily;
}

/** A relationship the tree's nesting doesn't show. */
export interface TreeLink {
  kind: EdgeKind;
  other: GraphNode;
}

export interface TreeItem {
  node: GraphNode;
  /** How it relates to the item it hangs under; null for the focus. */
  edge: EdgeKind | null;
  children: TreeItem[];
  also: TreeLink[];
}

export interface MappedGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  tree: TreeItem | null;
  /** The size of the drawing, margins included. */
  width: number;
  height: number;
}

const KIND_ORDER: EdgeKind[] = [
  "linked_launcher",
  "linked_console",
  "primary_email",
  "login_email",
  "recovery_email",
  "phone",
  "recovery_phone",
  "on_platform",
  "plays",
  "mfa",
  "owns",
];

function hangsUnder(byId: Map<string, GraphNode>, node: GraphNode, ancestor: string): boolean {
  let at = node.parent;
  for (let i = 0; at !== null && i <= byId.size; i++) {
    if (at === ancestor) return true;
    at = byId.get(at)?.parent ?? null;
  }
  return false;
}

/**
 * Turns Rust's graph into what the two views draw: a left-to-right layout
 * with the focus at the left, and the same data as a tree.
 *
 * An "assigned" link is left out when the account already hangs under that
 * identity another way (identity, its email, the account): the nesting says
 * it. Every other relationship appears once in each view, as a labelled line
 * on the canvas and as either the nesting or an "also" line in the tree.
 */
export function mapGraph(graph: Graph): MappedGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isTreeEdge = (e: GraphEdge) => {
    const [a, b] = [byId.get(e.source), byId.get(e.target)];
    return (
      (b?.parent === e.source && b.parentEdge === e.kind) || (a?.parent === e.target && a.parentEdge === e.kind)
    );
  };
  const shown = graph.edges.filter((e) => {
    const target = byId.get(e.target);
    if (!byId.has(e.source) || !target) return false;
    return !(e.kind === "owns" && !isTreeEdge(e) && hangsUnder(byId, target, e.source));
  });

  const children = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.parent === null || !byId.has(n.parent)) continue;
    children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  }
  const also = new Map<string, TreeLink[]>();
  for (const e of shown) {
    const other = byId.get(e.source);
    if (isTreeEdge(e) || !other) continue;
    also.set(e.target, [...(also.get(e.target) ?? []), { kind: e.kind, other }]);
  }
  const visited = new Set<string>();
  const item = (node: GraphNode): TreeItem => {
    visited.add(node.id);
    return {
      node,
      edge: node.id === graph.focus ? null : node.parentEdge,
      also: also.get(node.id) ?? [],
      children: (children.get(node.id) ?? []).filter((c) => !visited.has(c.id)).map(item),
    };
  };
  const root = byId.get(graph.focus);
  const tree = root ? item(root) : null;

  const layout = new dagre.graphlib.Graph();
  // The gap between columns leaves room for a line's label before the node it runs into.
  layout.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 176, marginx: MARGIN, marginy: MARGIN });
  layout.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) layout.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const n of graph.nodes) {
    if (n.parent !== null && byId.has(n.parent)) layout.setEdge(n.parent, n.id);
  }
  dagre.layout(layout);
  const nodes: MapNode[] = graph.nodes.map((node) => {
    const at = layout.node(node.id) as { x: number; y: number };
    return { node, x: at.x - NODE_WIDTH / 2, y: at.y - NODE_HEIGHT / 2, focus: node.id === graph.focus };
  });
  const xOf = new Map(nodes.map((n) => [n.node.id, n.x]));

  const pairs = new Map<string, MapEdge>();
  for (const e of shown) {
    const leftFirst = (xOf.get(e.source) ?? 0) <= (xOf.get(e.target) ?? 0);
    const [source, target] = leftFirst ? [e.source, e.target] : [e.target, e.source];
    const id = `${source}>${target}`;
    const edge = pairs.get(id) ?? { id, source, target, kinds: [], label: "", family: "uses" as EdgeFamily };
    edge.kinds.push(e.kind);
    pairs.set(id, edge);
  }
  const edges = [...pairs.values()].map((edge) => {
    const kinds = [...edge.kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    const first = kinds[0] ?? "owns";
    return { ...edge, kinds, label: kinds.map(edgeLabel).join(", "), family: edgeFamily(first) };
  });

  // A line between two nodes in one column loops out to the right of it, with its label.
  const loops = edges.some((e) => xOf.get(e.source) === xOf.get(e.target));
  const width = Math.max(0, ...nodes.map((n) => n.x + NODE_WIDTH)) + MARGIN + (loops ? LOOP_ROOM : 0);
  const height = Math.max(0, ...nodes.map((n) => n.y + NODE_HEIGHT)) + MARGIN;
  return { nodes, edges, tree, width, height };
}

/** How many items a tree holds, the focus included. */
export function treeSize(item: TreeItem | null): number {
  return item ? 1 + item.children.reduce((n, c) => n + treeSize(c), 0) : 0;
}
