import { events } from "./bindings";

/**
 * Subscribes to `vault://locked`. Returns an unsubscribe function that is safe
 * to call before the subscription has finished registering.
 */
export function onVaultLocked(handler: () => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  events.vaultLocked
    .listen(() => {
      handler();
    })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}
