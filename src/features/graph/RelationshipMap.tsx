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
import { PageHeader } from "@/features/shell/PageHeader";
import type { FocusKind, GraphFocus, GraphNode } from "@/ipc/client";
import { FocusPicker, type FocusGroup } from "./FocusPicker";
import { GraphCanvas } from "./GraphCanvas";
import { GraphListView } from "./GraphListView";
import { mapGraph } from "./graphMapper";
import { Legend } from "./Legend";
import { nodeTarget } from "./NodeCard";
import { useProspects } from "./Prospect";
import {
  setMapFocus,
  setMapScope,
  setMapView,
  useMapState,
  type MapScope,
  type MapView,
} from "./useMapFocus";

/** Above this many nodes the list is the view you land on; the map is one click away. */
export const LIST_DEFAULT_ABOVE = 80;

const keyOf = (f: GraphFocus) => `${f.kind}:${f.id}`;

function parseKey(key: string): GraphFocus {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at) as FocusKind, id: key.slice(at + 1) };
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The whole vault's relationships on one scrollable map, or one identity,
 * account, email, platform or game and what it is connected to; either as a
 * map or as the same data in a list. Clicking a record opens it; clicking an
 * email, phone, platform or game moves the map onto it.
 * An email accounts use whose mailbox isn't in the vault also gets a
 * prospective account, to add, edit first or discard.
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
    (node: GraphNode) =>
      // A prospective account is labelled with its address, so it is masked like the email.
      hide && (node.kind === "email" || node.kind === "prospective_account")
        ? (hidden.get(node.recordId) ?? "Hidden email")
        : node.label,
    [hide, hidden],
  );
  const prospects = useProspects(labelOf);

  const groups = useMemo(() => {
    const pick = (kind: FocusKind, rows: { id: string; label: string }[]) =>
      rows.map((r) => ({ key: keyOf({ kind, id: r.id }), label: r.label }));
    const points = contacts.data ?? [];
    const all: FocusGroup[] = [
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
    ];
    return all.filter((g) => g.options.length > 0);
  }, [refs.data, accounts.data, contacts.data, platforms.data, games.data, hide, hidden]);

  const sources = [refs, accounts, contacts, platforms, games];
  const loaded = sources.every((q) => q.data !== undefined);
  const options = groups.flatMap((g) => g.options);
  // A stored focus that no longer exists (deleted or archived since) falls back to the first choice.
  const stored = state.focus ? keyOf(state.focus) : null;
  const focusKey = (stored !== null && options.some((o) => o.key === stored) ? stored : options[0]?.key) ?? null;
  const all = state.scope === "all";
  // With nothing to choose from there is nothing to map either way.
  const target = !loaded || focusKey === null ? null : all ? "all" : parseKey(focusKey);
  const graph = useGraph(target);
  const mapped = useMemo(() => (graph.data ? mapGraph(graph.data) : null), [graph.data]);

  const onOpen = useCallback(
    (node: GraphNode) => {
      const target = nodeTarget(node);
      // A prospective account has nothing to open; its own buttons act on it.
      if (target.type === "prospect") return;
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
    // The last map stays up while the next loads, so go by what is drawn, not by what was asked for.
    const whole = graph.data.focus === null;
    const lone = !whole && count === 1;
    const notes = (
      <>
        {graph.data.truncated && (
          <p role="status" className="text-[13px] text-muted-foreground">
            {whole
              ? `Showing ${String(count)} records. Switch to Focused and choose one record to see the rest around it.`
              : `Showing the nearest ${String(count)} records. Choose a narrower focus, such as one account, to see the rest.`}
          </p>
        )}
        {lone && (
          <p className="text-[13px] text-muted-foreground">Nothing is linked to {labelOf(mapped.tree.node)} yet.</p>
        )}
      </>
    );
    body =
      view === "map" ? (
        <>
          {(graph.data.truncated || lone) && <div className="flex flex-col gap-1 px-6 pt-4">{notes}</div>}
          <div className="relative min-h-0 flex-1">
            <GraphCanvas mapped={mapped} labelOf={labelOf} onOpen={onOpen} prospects={prospects} fitted={!whole} />
          </div>
          <Legend className="shrink-0" />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-10">
          {notes}
          <GraphListView roots={mapped.roots} labelOf={labelOf} onFocus={setMapFocus} prospects={prospects} />
        </div>
      );
  }

  const actions = focusKey !== null && (
    <>
      <SegmentedGroup
        aria-label="Show"
        className="h-7"
        value={state.scope}
        onValueChange={(v) => {
          setMapScope(v as MapScope);
        }}
      >
        <SegmentedItem value="all">All</SegmentedItem>
        <SegmentedItem value="one">Focused</SegmentedItem>
      </SegmentedGroup>
      {!all && (
        <FocusPicker
          groups={groups}
          value={focusKey}
          onChange={(key) => {
            setMapFocus(parseKey(key));
          }}
        />
      )}
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
