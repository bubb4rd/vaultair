import { useEffect } from "react";
import { session } from "@/ipc/client";

/** At most one ping per this long. Rust owns the idle deadline (5 min by default). */
export const TOUCH_INTERVAL_MS = 15_000;

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * Tells Rust the user is active, so the idle lock doesn't fire mid-use.
 * Mounted only while unlocked. Renders nothing.
 *
 * Throttled with a trailing ping: activity inside an interval is reported
 * when the interval ends, so the idle deadline is never more than one
 * interval early.
 */
export function ActivityTracker() {
  useEffect(() => {
    let last = -Infinity;
    let trailing: number | undefined;
    const ping = () => {
      last = performance.now();
      trailing = undefined;
      session.touch().catch(() => undefined);
    };
    const onActivity = () => {
      const since = performance.now() - last;
      if (since >= TOUCH_INTERVAL_MS) ping();
      else trailing ??= window.setTimeout(ping, TOUCH_INTERVAL_MS - since);
    };
    const options = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, options);
    return () => {
      window.clearTimeout(trailing);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, options);
    };
  }, []);
  return null;
}
