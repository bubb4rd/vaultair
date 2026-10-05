import { cn } from "@/lib/utils";
import { EDGE_FAMILIES } from "./labels";

/** What each line style on the map means. Every line also carries its own label. */
export function Legend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Line styles"
      className={cn("flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border px-6 py-2", className)}
    >
      {EDGE_FAMILIES.map((f) => (
        <li key={f.family} className="flex items-center gap-2 text-xs text-muted-foreground">
          <svg aria-hidden="true" width="32" height="8" viewBox="0 0 32 8" className="shrink-0">
            <line
              x1="1"
              y1="4"
              x2="31"
              y2="4"
              strokeDasharray={f.dash}
              className={cn("map-legend-line", `map-edge-${f.family}`)}
            />
          </svg>
          {f.label}
        </li>
      ))}
    </ul>
  );
}
