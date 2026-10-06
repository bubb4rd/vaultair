import { Link } from "@tanstack/react-router";
import type { GraphFocus, GraphNode } from "@/ipc/client";
import type { TreeItem } from "./graphMapper";
import { edgeLabel } from "./labels";
import { NodeMark, focusOf, nodeCaption, nodeTarget } from "./NodeCard";
import type { Prospects } from "./Prospect";

const NAME =
  "min-w-0 truncate rounded-sm text-left text-[13px] text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";

const ACTION =
  "shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";

interface RowProps {
  item: TreeItem;
  labelOf: (node: GraphNode) => string;
  onFocus: (focus: GraphFocus) => void;
  prospects: Prospects;
}

function NodeName({ node, label, onFocus }: { node: GraphNode; label: string; onFocus: RowProps["onFocus"] }) {
  const target = nodeTarget(node);
  if (target.type === "identity") {
    return (
      <Link to="/identities/$identityId" params={{ identityId: target.identityId }} className={NAME}>
        {label}
      </Link>
    );
  }
  if (target.type === "account") {
    return (
      <Link
        to="/accounts/$accountId"
        params={{ accountId: target.accountId }}
        {...(target.hash ? { hash: target.hash } : {})}
        className={NAME}
      >
        {label}
      </Link>
    );
  }
  // A prospective account has no page and can't be a focus: its row carries the actions.
  if (target.type === "prospect") {
    return <span className="min-w-0 truncate text-[13px] text-foreground">{label}</span>;
  }
  return (
    <button
      type="button"
      aria-label={`Focus the map on ${label}`}
      className={NAME}
      onClick={() => {
        onFocus(target.focus);
      }}
    >
      {label}
    </button>
  );
}

/** Add, edit first or discard, for a prospective account's row. */
function ProspectActions({ node, label, prospects }: { node: GraphNode; label: string; prospects: Prospects }) {
  const busy = prospects.busy === node.id;
  const actions = [
    { text: "Add", name: `Add ${label} as an account`, run: prospects.add },
    { text: "Edit first", name: `Edit ${label} before adding it`, run: prospects.edit },
    { text: "Discard", name: `Discard the suggestion for ${label}`, run: prospects.discard },
  ];
  return (
    <>
      {actions.map((a) => (
        <button
          key={a.text}
          type="button"
          aria-label={a.name}
          disabled={busy}
          className={ACTION}
          onClick={() => {
            a.run(node);
          }}
        >
          {a.text}
        </button>
      ))}
    </>
  );
}

function Row({ item, labelOf, onFocus, prospects }: RowProps) {
  const { node } = item;
  const label = labelOf(node);
  const isFocus = item.focus;
  // Identities and accounts open their page from the name, so they get a
  // separate way to move the map onto them.
  const refocus = !isFocus && nodeTarget(node).type !== "focus" ? focusOf(node) : null;
  return (
    <li>
      <div className="flex min-h-9 items-center gap-2.5 py-1">
        {item.edge && <span className="shrink-0 text-xs text-subtle-foreground">{edgeLabel(item.edge)}</span>}
        <NodeMark node={node} label={label} size="xs" />
        <NodeName node={node} label={label} onFocus={onFocus} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {nodeCaption(node)}
          {isFocus && ", the focus"}
        </span>
        {refocus && (
          <button
            type="button"
            aria-label={`Focus the map on ${label}`}
            className={ACTION}
            onClick={() => {
              onFocus(refocus);
            }}
          >
            Focus
          </button>
        )}
        {node.kind === "prospective_account" && <ProspectActions node={node} label={label} prospects={prospects} />}
      </div>
      {item.also.length > 0 && (
        <ul aria-label={`Other links of ${label}`} className="pb-1 pl-8 text-xs text-muted-foreground">
          {item.also.map((link) => (
            <li key={`${link.kind}-${link.other.id}`}>
              {edgeLabel(link.kind)}: {labelOf(link.other)}
            </li>
          ))}
        </ul>
      )}
      {item.children.length > 0 && (
        <ul className="ml-3 border-l border-border pl-4">
          {item.children.map((child) => (
            <Row key={child.node.id} item={child} labelOf={labelOf} onFocus={onFocus} prospects={prospects} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The map as a nested list: the focus (or, for the whole vault, each tree's
 * root in turn), and under each record what hangs off
 * it, with the relationship written before each one. Links the nesting can't
 * show are listed under the record they lead to. A prospective account's row
 * ends with its add, edit and discard buttons. Plain links and buttons, so
 * Tab reaches everything.
 */
export function GraphListView({
  roots,
  labelOf,
  onFocus,
  prospects,
}: { roots: TreeItem[] } & Omit<RowProps, "item">) {
  return (
    <ul
      aria-label="Relationships"
      className="max-w-3xl divide-y divide-border rounded-lg border border-border bg-card px-4 py-1 [&>li]:py-1"
    >
      {roots.map((root) => (
        <Row key={root.node.id} item={root} labelOf={labelOf} onFocus={onFocus} prospects={prospects} />
      ))}
    </ul>
  );
}
