import { useSyncExternalStore } from "react";
import type { GraphFocus } from "@/ipc/client";

export type MapView = "map" | "list";
/** One record and what is around it, or the whole vault. */
export type MapScope = "one" | "all";

/**
 * What the relationship map shows (one record's surroundings or everything),
 * what it is centred on, and which view the user chose. Kept in memory for
 * the session, so it survives moving between pages; the webview reloads on
 * lock, which clears it.
 */
interface MapState {
  scope: MapScope;
  focus: GraphFocus | null;
  /** Null until the user picks one: the page then chooses (list for reduced motion or a large map). */
  view: MapView | null;
}

const INITIAL: MapState = { scope: "one", focus: null, view: null };
let current: MapState = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: MapState) {
  current = next;
  for (const l of listeners) l();
}

/** Centres the map on one record, leaving the whole-vault map if that was showing. */
export function setMapFocus(focus: GraphFocus | null) {
  set({ ...current, focus, scope: "one" });
}

export function setMapScope(scope: MapScope) {
  set({ ...current, scope });
}

export function setMapView(view: MapView | null) {
  set({ ...current, view });
}

export function resetMapState() {
  set(INITIAL);
}

export function useMapState(): MapState {
  return useSyncExternalStore(subscribe, () => current);
}
