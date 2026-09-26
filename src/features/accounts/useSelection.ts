import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Multi-select over the rows on screen, in their order. Only ids still in
 * the list count as selected, so a filter change never leaves hidden rows
 * selected. Shift selects the range from the last row toggled.
 */
export function useSelection(ids: string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const selected = useMemo(() => {
    const visible = new Set(ids);
    return new Set([...picked].filter((id) => visible.has(id)));
  }, [ids, picked]);

  const toggle = useCallback(
    (id: string, shift = false) => {
      const from = anchor.current ? ids.indexOf(anchor.current) : -1;
      const to = ids.indexOf(id);
      setPicked((prev) => {
        const visible = new Set(ids);
        const next = new Set([...prev].filter((p) => visible.has(p)));
        const on = !next.has(id);
        if (shift && from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (const rangeId of ids.slice(lo, hi + 1)) {
            if (on) next.add(rangeId);
            else next.delete(rangeId);
          }
        } else if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
      anchor.current = id;
    },
    [ids],
  );

  const all = ids.length > 0 && selected.size === ids.length;

  const toggleAll = useCallback(() => {
    setPicked(all ? new Set() : new Set(ids));
    anchor.current = null;
  }, [all, ids]);

  const clear = useCallback(() => {
    setPicked(new Set());
    anchor.current = null;
  }, []);

  return { selected, toggle, toggleAll, clear, all, some: selected.size > 0 && !all };
}

export type Selection = ReturnType<typeof useSelection>;
