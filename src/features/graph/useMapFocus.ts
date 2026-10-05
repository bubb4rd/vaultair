import { useSyncExternalStore } from "react";
import type { GraphFocus } from "@/ipc/client";

export type MapView = "map" | "list";

/**
 * What the relationship map is centred on, and which view the user chose.
 * Kept in memory for the session, so it survives moving between pages; the
 * webview reloads on lock, which clears it.
 */
interface MapState {
  focus: GraphFocus | null;
  /** Null until the user picks one: the page then chooses (list for reduced motion or a large map). */
  view: MapView | null;
}

let current: MapState = { focus: null, view: null };
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

export function setMapFocus(focus: GraphFocus | null) {
  set({ ...current, focus });
}

export function setMapView(view: MapView | null) {
  set({ ...current, view });
}

export function resetMapState() {
  set({ focus: null, view: null });
}

export function useMapState(): MapState {
  return useSyncExternalStore(subscribe, () => current);
}
