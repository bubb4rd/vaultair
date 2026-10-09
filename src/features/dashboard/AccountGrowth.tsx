import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOpenVault } from "@/app/queries";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardSummary, IdentityRef } from "@/ipc/client";
import { number, plural, sectionTitle, shortDate } from "./bits";
import type { GrowthDay } from "./growth";
import { dayDate, growthDays } from "./growth";

/** The dot grid: columns on a 9px pitch across the width, up to 18 rows on a 6px pitch. */
const ROWS = 18;
const ROW_PITCH = 6;
const COL_PITCH = 9;
const DOT_R = 2;
const PLOT_HEIGHT = ROWS * ROW_PITCH;
const PAD_TOP = 8;
const PAD_LEFT = 2;
/** Room under the dots for the date labels. */
const AXIS = 22;
const CHART_HEIGHT = PAD_TOP + PLOT_HEIGHT + AXIS;

const longDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Measure a container's content width and re-render when it changes. */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}

/**
 * How many dots a running total draws. One account is one dot until the
 * total passes the rows: then the largest total fills the chart and the
 * other columns scale down with it.
 */
function dotRows(count: number, peak: number): number {
  if (count <= 0) return 0;
  const unit = Math.max(1, peak / ROWS);
  return Math.min(ROWS, Math.max(1, Math.round(count / unit)));
}

/** One column: a day, or a run of days when there are more days than columns. */
interface Cell {
  first: GrowthDay;
  last: GrowthDay;
  added: number;
}

function cellsFor(days: GrowthDay[], columns: number): Cell[] {
  return Array.from({ length: columns }, (_, c) => {
    const from = Math.floor((c * days.length) / columns);
    const to = Math.max(from, Math.floor(((c + 1) * days.length) / columns) - 1);
    const run = days.slice(from, to + 1);
    const first = run[0] ?? { date: "", added: 0, total: 0 };
    const last = run[run.length - 1] ?? first;
    return { first, last, added: run.reduce((n, d) => n + d.added, 0) };
  });
}

function cellDate(cell: Cell): string {
  const a = shortDate.format(dayDate(cell.first.date));
  return cell.first.date === cell.last.date ? a : `${a} – ${shortDate.format(dayDate(cell.last.date))}`;
}

/**
 * The running total of accounts as a dot matrix, lit from the bottom, one
 * column per day from the vault's creation, growing right. Days before the
 * first account have no dots. Only a vault older than the plot is wide is
 * compressed, each column then covering a run of days. Every dot is the
 * same grey until a column is hovered or focused: its accounts added that
 * day turn brand blue and the tooltip gives the numbers.
 */
function GrowthChart({ days, identity }: { days: GrowthDay[]; identity: string | undefined }) {
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState<number | null>(null);

  const start = days[0];
  const end = days[days.length - 1];
  if (!start || !end) return null;
  const peak = end.total;

  const capacity = Math.max(1, Math.floor((width - PAD_LEFT * 2) / COL_PITCH));
  const packed = days.length <= capacity;
  const cells = cellsFor(days, packed ? days.length : capacity);
  const unit = Math.max(1, peak / ROWS);
  const xOf = (c: number) => PAD_LEFT + c * COL_PITCH + COL_PITCH / 2;
  const yOfRow = (row: number) => PAD_TOP + PLOT_HEIGHT - (row + 0.5) * ROW_PITCH;

  // Date labels sit on the columns. A short run has one label at the start,
  // so it doesn't collide with the next day 9px away.
  const labelAt =
    cells.length <= 1 || (packed && cells.length * COL_PITCH < 120)
      ? [0]
      : [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (cells.length - 1))))];
  const labels = labelAt.map((c, i) => {
    const cell = cells[c];
    return {
      x: i === 0 ? PAD_LEFT : xOf(c),
      text: shortDate.format(dayDate((i === 0 ? cell?.first : cell?.last)?.date ?? end.date)),
      anchor: i === 0 ? ("start" as const) : i === labelAt.length - 1 && !packed ? ("end" as const) : ("middle" as const),
    };
  });

  const since = longDate.format(dayDate(start.date));
  const summary = `Account growth${identity ? ` for ${identity}` : ""} since ${since}: ${plural(peak, "account")} added. Deleted accounts aren't counted.`;
  const scale = peak > ROWS ? `Columns are scaled so the tallest, ${number.format(peak)}, fills the chart.` : "Each dot is one account.";
  const columns =
    days.length === 1
      ? "The vault was created today; a column is added each day."
      : packed
        ? "Each column is one day."
        : `Each column covers about ${plural(Math.round(days.length / cells.length), "day")}.`;
  const caption = `The running total of ${identity ? `${identity} accounts` : "accounts"} added since the vault was created. ${columns} ${scale} Archived accounts count. Deleted accounts don't, so the totals are a lower bound.`;

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="w-full">
        {width > 0 ? (
          <svg role="img" aria-label={summary} width={width} height={CHART_HEIGHT} className="block overflow-visible">
            <g aria-hidden="true">
              {cells.map((cell, c) => {
                const rows = dotRows(cell.last.total, peak);
                const active = hovered === c;
                // The dots for this column's additions sit on top of the older ones.
                const fresh = active && cell.added > 0 ? Math.min(rows, Math.max(1, Math.round(cell.added / unit))) : 0;
                return (
                  <g key={c}>
                    {Array.from({ length: rows }, (_, row) => (
                      <circle
                        key={row}
                        cx={xOf(c)}
                        cy={yOfRow(row)}
                        r={DOT_R}
                        className={
                          row >= rows - fresh
                            ? "fill-brand"
                            : active
                              ? "fill-foreground"
                              : hovered === null
                                ? "fill-muted-foreground"
                                : "fill-muted-foreground/60"
                        }
                      />
                    ))}
                  </g>
                );
              })}
            </g>
            <g aria-hidden="true">
              {labels.map((l) => (
                <text
                  key={`${String(l.x)}-${l.text}`}
                  x={l.x}
                  y={CHART_HEIGHT - 4}
                  textAnchor={l.anchor}
                  className="fill-subtle-foreground text-[11px] tabular-nums"
                >
                  {l.text}
                </text>
              ))}
            </g>
            {/* Hover targets, one per column. Opening the tooltip highlights the column. */}
            <g aria-hidden="true">
              {cells.map((cell, c) => (
                <Tooltip
                  key={c}
                  onOpenChange={(open) => {
                    setHovered(open ? c : null);
                  }}
                >
                  <TooltipTrigger asChild>
                    <rect
                      x={PAD_LEFT + c * COL_PITCH}
                      y={0}
                      width={COL_PITCH}
                      height={PAD_TOP + PLOT_HEIGHT}
                      fill="transparent"
                      className="cursor-default"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4} className="flex flex-col gap-1 tabular-nums">
                    <span className="font-semibold">{cellDate(cell)}</span>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 rounded-[2px] bg-brand" />
                      Added
                      <span className="ml-auto pl-3 font-semibold">{number.format(cell.added)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 rounded-[2px] bg-foreground" />
                      Total
                      <span className="ml-auto pl-3 font-semibold">{number.format(cell.last.total)}</span>
                    </span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </g>
          </svg>
        ) : (
          <div style={{ height: CHART_HEIGHT }} />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/**
 * How the vault has grown since it was created. This is not health: the
 * app keeps no history of the checks, only when each account was added.
 */
export function AccountGrowth({ summary: s, filtered }: { summary: DashboardSummary; filtered: IdentityRef | undefined }) {
  const vaultCreatedAt = useOpenVault()?.createdAt ?? null;
  const identity = filtered?.name;
  const days = useMemo(() => growthDays(vaultCreatedAt, s.accountsCreatedAt, new Date()), [vaultCreatedAt, s.accountsCreatedAt]);
  const added = s.accountsCreatedAt.length;
  const since = days[0] ? longDate.format(dayDate(days[0].date)) : null;
  return (
    <section aria-labelledby="dashboard-growth" className="flex min-w-0 flex-col gap-3">
      <h2 id="dashboard-growth" className={sectionTitle}>
        Account growth
      </h2>
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{number.format(added)}</span>{" "}
        {added === 1 ? "account" : "accounts"} added{since ? ` since ${since}` : ""}
      </p>
      {added === 0 ? (
        <p className="text-xs text-muted-foreground">Accounts appear here as you add them.</p>
      ) : (
        <GrowthChart days={days} identity={identity} />
      )}
    </section>
  );
}
