import { useSyncExternalStore } from "react";
import { useIdentityRefs } from "@/app/queries";

/**
 * The dashboard's identity filter. Kept in memory for the session, so it
 * survives moving between pages; the webview reloads on lock, which clears it.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setIdentityFilter(id: string | null) {
  if (current === id) return;
  current = id;
  for (const l of listeners) l();
}

/**
 * `[identityId, set]`. A filter naming an identity that's no longer active
 * (deleted or archived since) reads as "all identities".
 */
export function useIdentityFilter(): [string | null, (id: string | null) => void] {
  const stored = useSyncExternalStore(subscribe, () => current);
  const refs = useIdentityRefs();
  const valid = stored !== null && (refs.data?.some((r) => r.id === stored) ?? false);
  return [valid ? stored : null, setIdentityFilter];
}
