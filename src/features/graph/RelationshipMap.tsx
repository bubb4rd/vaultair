import { useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GraphIcon } from "@phosphor-icons/react";
import {
  useAccounts,
  useContactPoints,
  useGames,
  useGraph,
  useIdentityRefs,
  usePlatforms,
  useSessionConfig,
} from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { SegmentedGroup, SegmentedItem } from "@/components/ui/radio-group";
import { NativeSelect } from "@/components/ui/textarea";
import { PageHeader } from "@/features/shell/PageHeader";
import type { FocusKind, GraphFocus, GraphNode } from "@/ipc/client";
import { GraphCanvas } from "./GraphCanvas";
import { GraphListView } from "./GraphListView";
import { mapGraph } from "./graphMapper";
import { Legend } from "./Legend";
import { nodeTarget } from "./NodeCard";
import { setMapFocus, setMapView, useMapState, type MapView } from "./useMapFocus";

/** Above this many nodes the list is the view you land on; the map is one click away. */
export const LIST_DEFAULT_ABOVE = 80;

interface FocusOption {
  focus: GraphFocus;
  label: string;
}

const keyOf = (f: GraphFocus) => `${f.kind}:${f.id}`;

function parseKey(key: string): GraphFocus {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at) as FocusKind, id: key.slice(at + 1) };
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Pick an identity, account, email, platform or game and see what it is
 * connected to, as a map or as the same data in a list. Clicking a record
 * opens it; clicking an email, phone, platform or game moves the map onto it.
 */
export function RelationshipMap() {
  const state = useMapState();
  const navigate = useNavigate();
  const refs = useIdentityRefs();
  const accounts = useAccounts();
  const contacts = useContactPoints();
  const platforms = usePlatforms();
  const games = useGames();
  const hide = useSessionConfig().data?.hideEmails ?? false;

  // With emails hidden, each one gets a stable stand-in name so they can still be told apart.
  const hidden = useMemo(() => {
    const emails = (contacts.data ?? []).filter((c) => c.kind === "email");
    return new Map(emails.map((c, i) => [c.id, `Hidden email ${String(i + 1)}`]));
  }, [contacts.data]);
  const labelOf = useCallback(
    (node: GraphNode) => (hide && node.kind === "email" ? (hidden.get(node.recordId) ?? "Hidden email") : node.label),
    [hide, hidden],
  );

  const groups = useMemo(() => {
    const pick = (kind: FocusKind, rows: { id: string; label: string }[]): FocusOption[] =>
      rows.map((r) => ({ focus: { kind, id: r.id }, label: r.label }));
    const points = contacts.data ?? [];
    return [
      { label: "Identities", options: pick("identity", (refs.data ?? []).map((r) => ({ id: r.id, label: r.name }))) },
      { label: "Accounts", options: pick("account", (accounts.data ?? []).map((a) => ({ id: a.id, label: a.title }))) },
      {
        label: "Emails",
        options: pick(
          "contact",
          points
            .filter((c) => c.kind === "email")
            .map((c) => ({ id: c.id, label: hide ? (hidden.get(c.id) ?? "Hidden email") : c.value })),
        ),
      },
      {
        label: "Recovery methods",
        options: pick("contact", points.filter((c) => c.kind === "phone").map((c) => ({ id: c.id, label: c.value }))),
      },
      {
        label: "Platforms",
        options: pick(
          "platform",
          (platforms.data ?? []).filter((p) => p.accountCount > 0).map((p) => ({ id: p.id, label: p.name })),
        ),
      },
      {
        label: "Games",
        options: pick(
          "game",
          (games.data ?? [])
            .filter((g) => g.accountCount > 0 || g.profileCount > 0)
            .map((g) => ({ id: g.id, label: g.name })),
        ),
      },
    ].filter((g) => g.options.length > 0);
  }, [refs.data, accounts.data, contacts.data, platforms.data, games.data, hide, hidden]);

  const sources = [refs, accounts, contacts, platforms, games];
  const loaded = sources.every((q) => q.data !== undefined);
  const options = groups.flatMap((g) => g.options);
  // A stored focus that no longer exists (deleted or archived since) falls back to the first choice.
  const stored = state.focus;
  const focus =
    (stored && options.some((o) => keyOf(o.focus) === keyOf(stored)) ? stored : options[0]?.focus) ?? null;
  const graph = useGraph(loaded ? focus : null);
  const mapped = useMemo(() => (graph.data ? mapGraph(graph.data) : null), [graph.data]);

  const onOpen = useCallback(
    (node: GraphNode) => {
      const target = nodeTarget(node);
      if (target.type === "focus") setMapFocus(target.focus);
      else if (target.type === "identity") {
        void navigate({ to: "/identities/$identityId", params: { identityId: target.identityId } });
      } else {
        void navigate({
          to: "/accounts/$accountId",
          params: { accountId: target.accountId },
          ...(target.hash ? { hash: target.hash } : {}),
        });
      }
    },
    [navigate],
  );

  const count = graph.data?.nodes.length ?? 0;
  const view: MapView = state.view ?? (prefersReducedMotion() || count > LIST_DEFAULT_ABOVE ? "list" : "map");

  let body: ReactNode = null;
  if (sources.some((q) => q.isError) || graph.isError) {
    body = (
      <div className="px-6">
        <EmptyState
          icon={GraphIcon}
          title="Couldn't load the relationship map"
          description="Lock and unlock the vault, then try again."
        />
      </div>
    );
  } else if (loaded && options.length === 0) {
    body = (
      <div className="px-6">
        <EmptyState
          icon={GraphIcon}
          title="Nothing to map yet"
          description="Links between identities, accounts, emails and recovery methods are drawn here as you add them."
        />
      </div>
    );
  } else if (graph.data && mapped?.tree) {
    const notes = (
      <>
        {graph.data.truncated && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Showing the nearest {count} records. Choose a narrower focus, such as one account, to see the rest.
          </p>
        )}
        {count === 1 && (
          <p className="text-[13px] text-muted-foreground">Nothing is linked to {labelOf(mapped.tree.node)} yet.</p>
        )}
      </>
    );
    body =
      view === "map" ? (
        <>
          {(graph.data.truncated || count === 1) && <div className="flex flex-col gap-1 px-6 pt-4">{notes}</div>}
          <div className="relative min-h-0 flex-1">
            <GraphCanvas mapped={mapped} labelOf={labelOf} onOpen={onOpen} />
          </div>
          <Legend className="shrink-0" />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-10">
          {notes}
          <GraphListView tree={mapped.tree} labelOf={labelOf} onFocus={setMapFocus} />
        </div>
      );
  }

  const actions = focus && (
    <>
      <div className="w-56">
        <NativeSelect
          aria-label="Focus"
          className="h-7 text-[13px]"
          value={keyOf(focus)}
          onChange={(e) => {
            setMapFocus(parseKey(e.target.value));
          }}
        >
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={keyOf(o.focus)} value={keyOf(o.focus)}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      <SegmentedGroup
        aria-label="View"
        className="h-7"
        value={view}
        onValueChange={(v) => {
          setMapView(v as MapView);
        }}
      >
        <SegmentedItem value="map">Map</SegmentedItem>
        <SegmentedItem value="list">List</SegmentedItem>
      </SegmentedGroup>
    </>
  );

  return (
    <>
      <PageHeader title="Relationship Map" actions={actions} />
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </>
  );
}
