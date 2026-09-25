import { events } from "./bindings";

type Listenable = { listen: (cb: () => void) => Promise<() => void> };

/**
 * Subscribes to a Rust event. Returns an unsubscribe function that is safe
 * to call before the subscription has finished registering.
 */
function subscribe(event: Listenable, handler: () => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  event
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

/** `vault://locked`: the vault closed (button, Ctrl+L, idle, Win+L, sleep). */
export function onVaultLocked(handler: () => void): () => void {
  return subscribe(events.vaultLocked, handler);
}

/** `clipboard://cleared`: a pending clipboard clear finished. */
export function onClipboardCleared(handler: () => void): () => void {
  return subscribe(events.clipboardCleared, handler);
}
