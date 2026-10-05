import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { CornersOutIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import type { GraphNode } from "@/ipc/client";
import { NODE_HEIGHT, NODE_WIDTH, type MapEdge, type MapNode, type MappedGraph } from "./graphMapper";
import { familyDash } from "./labels";
import { NodeCard, nodeCaption, nodeTarget } from "./NodeCard";
import "./graph.css";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.5;
const STEP = 0.15;
/** How far apart lines arrive at one node: a label's height plus a pixel. */
const LABEL_STEP = 19;

const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The zoom that shows the whole drawing, never enlarged past its real size. */
function fitZoom(box: HTMLElement, width: number, height: number): number {
  if (box.clientWidth === 0 || box.clientHeight === 0) return 1;
  return clamp(Math.min(1, box.clientWidth / width, box.clientHeight / height));
}

/** From the right edge of the left node to the left edge of the right one, as a soft S. */
function linePath(from: MapNode, to: MapNode, y2: number): string {
  const [x1, y1] = [from.x + NODE_WIDTH, from.y + NODE_HEIGHT / 2];
  const x2 = to.x;
  // Two nodes in one column: loop out to the right and back in, further out
  // the further apart they are, so several loops nest instead of overlapping.
  if (x2 <= x1) {
    const out = x1 + 28 + Math.min(72, Math.abs(y2 - y1) / 5);
    return `M ${String(x1)} ${String(y1)} C ${String(out)} ${String(y1)}, ${String(out)} ${String(y2)}, ${String(to.x + NODE_WIDTH)} ${String(y2)}`;
  }
  const bend = (x2 - x1) / 2;
  return `M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`;
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-7 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&>svg]:size-3.5"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The map itself. Positions come from the mapper and nothing moves by
 * itself: the drawing scrolls (drag the background, or use the scrollbars
 * and the keyboard) and zooms with the corner buttons. Every node is a
 * button. The list view shows the same data without a canvas.
 *
 * Drawn here, not with a graph library: the ones built on d3 assign to
 * prototypes at load, which the frozen-prototype security setting forbids.
 */
export function GraphCanvas({
  mapped,
  labelOf,
  onOpen,
}: {
  mapped: MappedGraph;
  labelOf: (node: GraphNode) => string;
  onOpen: (node: GraphNode) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { width, height } = mapped;

  // A new drawing starts fitted to the window.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    setZoom(fitZoom(box, width, height));
    box.scrollTo(0, 0);
  }, [width, height]);

  const at = new Map(mapped.nodes.map((n) => [n.node.id, n]));
  const lines = mapped.edges.flatMap((edge: MapEdge) => {
    const [from, to] = [at.get(edge.source), at.get(edge.target)];
    return from && to ? [{ edge, from, to, before: to.x > from.x, endY: to.y + NODE_HEIGHT / 2 }] : [];
  });
  // Several lines into one node arrive one under another, top to bottom in
  // the order they come from, so each label sits on its own line.
  const arrivals = new Map<string, typeof lines>();
  for (const line of lines) {
    const side = `${line.to.node.id}|${String(line.before)}`;
    arrivals.set(side, [...(arrivals.get(side) ?? []), line]);
  }
  for (const group of arrivals.values()) {
    group.sort((a, b) => a.from.y - b.from.y);
    group.forEach((line, i) => {
      line.endY += (i - (group.length - 1) / 2) * LABEL_STEP;
    });
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    e.currentTarget.scrollBy(drag.current.x - e.clientX, drag.current.y - e.clientY);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div role="group" aria-label="Relationship map" className="absolute inset-0">
      <div
        ref={scroller}
        className="absolute inset-0 cursor-grab overflow-auto active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="relative origin-top-left" style={{ width, height, transform: `scale(${String(zoom)})` }}>
            <svg aria-hidden="true" width={width} height={height} className="absolute inset-0">
              {lines.map(({ edge, from, to, endY }) => (
                <path
                  key={edge.id}
                  d={linePath(from, to, endY)}
                  strokeDasharray={familyDash(edge.family)}
                  className={`map-edge map-edge-${edge.family}`}
                />
              ))}
            </svg>
            {lines.map(({ edge, to, before, endY }) => (
              // The relationship is written just before the node the line runs
              // into, or just after it when the line loops back within a column.
              <span
                key={edge.id}
                className="map-edge-label"
                title={edge.label}
                style={{
                  left: before ? to.x - 10 : to.x + NODE_WIDTH + 10,
                  top: endY,
                  transform: before ? "translate(-100%, -50%)" : "translate(0, -50%)",
                }}
              >
                {edge.label}
              </span>
            ))}
            {mapped.nodes.map(({ node, x, y, focus }) => {
              const label = labelOf(node);
              const verb = nodeTarget(node).type === "focus" ? "Focus the map on" : "Open";
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-label={`${verb} ${label}, ${nodeCaption(node)}`}
                  aria-current={focus ? "true" : undefined}
                  className="absolute rounded-lg hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ring"
                  style={{ left: x, top: y }}
                  onClick={() => {
                    onOpen(node);
                  }}
                >
                  <NodeCard node={node} label={label} focus={focus} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div
        role="group"
        aria-label="Zoom"
        className="absolute right-4 bottom-4 flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border-strong bg-popover"
      >
        <ZoomButton
          label="Zoom in"
          onClick={() => {
            setZoom((z) => clamp(z + STEP));
          }}
        >
          <PlusIcon aria-hidden="true" />
        </ZoomButton>
        <ZoomButton
          label="Zoom out"
          onClick={() => {
            setZoom((z) => clamp(z - STEP));
          }}
        >
          <MinusIcon aria-hidden="true" />
        </ZoomButton>
        <ZoomButton
          label="Fit to window"
          onClick={() => {
            if (scroller.current) setZoom(fitZoom(scroller.current, width, height));
          }}
        >
          <CornersOutIcon aria-hidden="true" />
        </ZoomButton>
      </div>
    </div>
  );
}
