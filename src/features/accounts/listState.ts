import { useSyncExternalStore } from "react";
import { DEFAULT_SORT, EMPTY_FILTER, type AccountFilter, type AccountSort, type SavedView } from "@/ipc/client";

export type ListLayout = "table" | "cards" | "compact";

/**
 * What an account list shows: the saved view it started from (if any), the
 * filter and sort as edited since, and the layout. Kept in memory for the
 * session, per list, so opening an account and coming back keeps them. It
 * holds names and ids only, and it's gone when the vault locks (the page
 * reloads).
 */
export interface ListState {
  viewId: string | null;
  filter: AccountFilter;
  sort: AccountSort;
  layout: ListLayout;
  /** Bumped when a view replaces the filter, so the search box starts over from it. */
  revision: number;
}

export type ListKey = "accounts" | "archived";

export const ARCHIVED_VIEW_ID = "builtin-view-archived";

const INITIAL: Record<ListKey, ListState> = {
  accounts: { viewId: null, filter: EMPTY_FILTER, sort: DEFAULT_SORT, layout: "table", revision: 0 },
  archived: {
    viewId: ARCHIVED_VIEW_ID,
    filter: { ...EMPTY_FILTER, archived: true },
    sort: DEFAULT_SORT,
    layout: "table",
    revision: 0,
  },
};

let state: Record<ListKey, ListState> = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setListState(key: ListKey, update: Partial<ListState>) {
  state = { ...state, [key]: { ...state[key], ...update } };
  for (const l of listeners) l();
}

/** Shows a saved view's filter and sort (`null`: all accounts, no filter). */
export function openView(key: ListKey, view: SavedView | null) {
  setListState(key, {
    viewId: view?.id ?? null,
    filter: view ? view.spec.filter : EMPTY_FILTER,
    sort: view?.spec.sort ?? DEFAULT_SORT,
    revision: state[key].revision + 1,
  });
}

/** For tests: back to a fresh session. */
export function resetListState() {
  state = INITIAL;
  for (const l of listeners) l();
}

export function useListState(key: ListKey): ListState {
  return useSyncExternalStore(subscribe, () => state[key]);
}
