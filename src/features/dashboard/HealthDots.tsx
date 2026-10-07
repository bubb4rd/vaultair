import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { PAGE_PATHS } from "@/app/nav";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { daysSince } from "@/features/accounts/labels";
import type { DashboardSummary, IdentityRef } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { MoreLink, bigNumber, number, plural, sectionTitle, shortDate } from "./bits";
import type { HealthCheck, HealthCounts, HealthTrendPoint } from "./healthTrend";
import { HEALTH_CHECKS, localDay, totalOf, useHealthTrend } from "./healthTrend";

/** One check's name and colours. Class names are spelled out so Tailwind can find them. */
const CHECKS: Record<HealthCheck, { label: string; fill: string; swatch: string }> = {
  weak: { label: "Weak passwords", fill: "fill-status-risk", swatch: "bg-status-risk" },
  reused: { label: "Reused passwords", fill: "fill-status-risk", swatch: "bg-status-risk" },
  missingMfa: { label: "Missing MFA", fill: "fill-status-warning", swatch: "bg-status-warning" },
  missingRecoveryCodes: { label: "Missing recovery codes", fill: "fill-status-attention", swatch: "bg-status-attention" },
  dormant: { label: "Dormant", fill: "fill-status-dormant", swatch: "bg-status-dormant" },
};

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

/** "YYYY-MM-DD" as a local date, for display. */
function dayDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function changeWords(first: HealthTrendPoint, last: HealthTrendPoint): string {
  const a = totalOf(first.counts);
  const b = totalOf(last.counts);
  const when = shortDate.format(dayDate(first.date));
  if (b < a) return `down ${number.format(a - b)} since ${when}`;
  if (b > a) return `up ${number.format(b - a)} since ${when}`;
  return `unchanged since ${when}`;
}

/** Counts at a fractional position along the recorded days, linearly between neighbours. */
function countsAt(points: HealthTrendPoint[], t: number): HealthCounts {
  const i0 = Math.min(points.length - 1, Math.max(0, Math.floor(t)));
  const i1 = Math.min(points.length - 1, i0 + 1);
  const f = t - i0;
  const a = points[i0]?.counts;
  const b = points[i1]?.counts;
  const out = { weak: 0, reused: 0, missingMfa: 0, missingRecoveryCodes: 0, dormant: 0 };
  if (!a || !b) return out;
  for (const k of HEALTH_CHECKS) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

/**
 * How many dots each check gets in a column of `rows` dots, in proportion
 * to its count, by largest remainder so the parts add up to the column.
 */
function splitRows(counts: HealthCounts, rows: number): Record<HealthCheck, number> {
  const total = totalOf(counts);
  const out = { weak: 0, reused: 0, missingMfa: 0, missingRecoveryCodes: 0, dormant: 0 };
  if (total <= 0 || rows <= 0) return out;
  const exact = HEALTH_CHECKS.map((k) => ({ k, v: (counts[k] / total) * rows }));
  let used = 0;
  for (const e of exact) {
    out[e.k] = Math.floor(e.v);
    used += out[e.k];
  }
  const byRemainder = [...exact].sort((x, y) => y.v - Math.floor(y.v) - (x.v - Math.floor(x.v)));
  for (let i = 0; used < rows && i < byRemainder.length; i += 1, used += 1) {
    const e = byRemainder[i];
    if (e) out[e.k] += 1;
  }
  return out;
}

/**
 * How many dots a day's issue count draws.
 *
 * One open issue is one dot. The grid compresses only when the busiest day
 * has more issues than there are rows: that day fills the chart and quieter
 * days scale down with it. A quiet day is never stretched to the top just
 * because it is the peak. That matters while history is a single snapshot:
 * today is always the peak, so peak-relative scaling painted a full grid for
 * one issue and still did after the user came back and fixed some.
 */
function dotRows(total: number, peak: number): number {
  if (total <= 0) return 0;
  const unit = Math.max(1, peak / ROWS);
  return Math.min(ROWS, Math.max(1, Math.round(total / unit)));
}

/**
 * Open issues per day as a dot matrix in the style of a signal chart, lit
 * from the bottom. Recorded days start at the left and step right, one
 * column every 9px. A history shorter than the plot leaves the rest empty.
 * Only a history with more days than columns is compressed across the full
 * width, with the columns between recorded days interpolated. Every dot is
 * the same grey until a column is hovered or focused: then its dots split
 * into the five checks in their status colours and the tooltip lists the
 * counts for the nearest day.
 */
function DotChart({ today, scope }: { today: HealthTrendPoint; scope: string }) {
  const points = useHealthTrend(today);
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState<number | null>(null);

  const first = points[0] ?? today;
  const last = points[points.length - 1] ?? today;
  const single = points.length === 1;
  const span = daysSince(dayDate(first.date).toISOString(), dayDate(last.date));
  const todayTotal = totalOf(last.counts);

  const capacity = Math.max(1, Math.floor((width - PAD_LEFT * 2) / COL_PITCH));
  // Short histories stay left-aligned: one column per day, growing right.
  // A longer history is the only case that fills the plot.
  const packed = points.length <= capacity;
  const columns = packed ? points.length : capacity;
  const cells = Array.from({ length: columns }, (_, c) => {
    const t = packed || columns === 1 ? c : (c / (columns - 1)) * (points.length - 1);
    const counts = countsAt(points, t);
    const nearest = points[Math.round(t)] ?? last;
    return { counts, total: totalOf(counts), nearest };
  });
  const peak = Math.max(1, ...points.map((p) => totalOf(p.counts)));
  const peakDay = points.find((p) => totalOf(p.counts) === peak) ?? last;
  const xOf = (c: number) => PAD_LEFT + c * COL_PITCH + COL_PITCH / 2;
  const yOfRow = (row: number) => PAD_TOP + PLOT_HEIGHT - (row + 0.5) * ROW_PITCH;

  // Date labels sit on the columns. A short run has one label at the start,
  // so it doesn't collide with the next day 9px away.
  const labelAt =
    columns <= 1 || (packed && columns * COL_PITCH < 120)
      ? [0]
      : [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (columns - 1))))];
  const labels = labelAt.map((c, i) => ({
    x: i === 0 ? PAD_LEFT : xOf(c),
    text: shortDate.format(dayDate((packed ? points[c] : cells[c]?.nearest)?.date ?? last.date)),
    anchor: i === 0 ? ("start" as const) : i === labelAt.length - 1 && !packed ? ("end" as const) : ("middle" as const),
  }));

  const summary = single
    ? `Security health today: ${plural(todayTotal, "open issue")} across ${scope}. No earlier days are recorded.`
    : `Security health over the last ${plural(span, "day")}: ${plural(todayTotal, "open issue")} today, ${changeWords(first, last)}. Peak ${number.format(peak)}.`;
  const oneDot =
    todayTotal <= 0
      ? ""
      : todayTotal > ROWS
        ? ` The column stops at ${String(ROWS)} dots; the figure above is the full count.`
        : " Each dot is one open issue.";
  const caption = single
    ? `Open issues across the five checks for ${scope}.${oneDot} History builds up from today; the counts are recorded each time the dashboard opens.`
    : `Open issues across the five checks for ${scope}. ${peak > ROWS ? `The tallest column is the busiest day, ${number.format(peak)} on ${shortDate.format(dayDate(peakDay.date))}.` : "Each dot is one open issue."} An account with more than one issue counts once per check. ${packed ? "Each recorded day is a column, starting at the left." : "Days between records are filled in."} Hover a column for its breakdown.`;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-baseline gap-2">
        <span className={bigNumber}>{number.format(todayTotal)}</span>
        <span className="text-[13px] text-muted-foreground">
          {todayTotal === 1 ? "open issue" : "open issues"}
          {!single && <span className="tabular-nums"> · {changeWords(first, last)}</span>}
        </span>
      </p>
      <div ref={ref} className="w-full">
        {width > 0 ? (
          <svg role="img" aria-label={summary} width={width} height={CHART_HEIGHT} className="block overflow-visible">
            <g aria-hidden="true">
              {cells.map((cell, c) => {
                const rows = dotRows(cell.total, peak);
                const active = hovered === c;
                const split = active ? splitRows(cell.counts, rows) : null;
                // Dots from the bottom, each check's run stacked in check order.
                const fills: string[] = [];
                if (split) for (const k of HEALTH_CHECKS) for (let n = 0; n < split[k]; n += 1) fills.push(CHECKS[k].fill);
                return (
                  <g key={c}>
                    {Array.from({ length: rows }, (_, row) => (
                      <circle
                        key={row}
                        cx={xOf(c)}
                        cy={yOfRow(row)}
                        r={DOT_R}
                        className={fills[row] ?? (hovered === null ? "fill-muted-foreground" : "fill-muted-foreground/60")}
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
            {/* Hover targets, one per column. Opening the tooltip colours the column. */}
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
                    <span className="font-semibold">
                      {shortDate.format(dayDate(cell.nearest.date))} · {plural(totalOf(cell.nearest.counts), "issue")}
                    </span>
                    {HEALTH_CHECKS.filter((k) => cell.nearest.counts[k] > 0).map((k) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span aria-hidden="true" className={cn("size-2 rounded-[2px]", CHECKS[k].swatch)} />
                        {CHECKS[k].label}
                        <span className="ml-auto pl-3 font-semibold">{number.format(cell.nearest.counts[k])}</span>
                      </span>
                    ))}
                  </TooltipContent>
                </Tooltip>
              ))}
            </g>
          </svg>
        ) : (
          <div style={{ height: CHART_HEIGHT }} />
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{caption}</p>
    </div>
  );
}

export function HealthDots({ summary: s, filtered }: { summary: DashboardSummary; filtered: IdentityRef | undefined }) {
  const scope = filtered ? `${filtered.name} accounts` : "all active accounts";
  const today: HealthTrendPoint = {
    date: localDay(new Date()),
    counts: {
      weak: s.weak,
      reused: s.reused,
      missingMfa: s.missingMfa,
      missingRecoveryCodes: s.missingRecoveryCodes,
      dormant: s.dormant,
    },
  };
  return (
    <section aria-labelledby="dashboard-health" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dashboard-health" className={sectionTitle}>
          Security health
        </h2>
        <MoreLink to={PAGE_PATHS.health}>Open Security Health</MoreLink>
      </div>
      {s.totalAccounts === 0 ? (
        <p className="text-[13px] text-muted-foreground">No accounts yet</p>
      ) : (
        <DotChart today={today} scope={scope} />
      )}
    </section>
  );
}
