import { useMemo } from "react";

/**
 * One day of the security health counts, for the dot chart on the dashboard.
 *
 * The app keeps no history of health: Rust computes the checks live each
 * time the dashboard loads. Recording a daily snapshot of the counts is a
 * backend task (a small `health_history` table written on unlock and read
 * here). Until that exists, production has no source and the chart shows
 * today only. The dev gallery injects thirty days of fixture counts through
 * `setHealthTrendSource`.
 */
export const HEALTH_CHECKS = ["weak", "reused", "missingMfa", "missingRecoveryCodes", "dormant"] as const;

export type HealthCheck = (typeof HEALTH_CHECKS)[number];

/** How many active accounts each check flags. An account can appear under several. */
export type HealthCounts = Record<HealthCheck, number>;

export interface HealthTrendPoint {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  counts: HealthCounts;
}

/** The five counts added up: open issues, counting an account once per check. */
export function totalOf(counts: HealthCounts): number {
  return HEALTH_CHECKS.reduce((n, key) => n + counts[key], 0);
}

type HealthTrendSource = () => HealthTrendPoint[];

let source: HealthTrendSource | null = null;

/** Install (or clear) where past counts come from. Nothing is persisted. */
export function setHealthTrendSource(next: HealthTrendSource | null): void {
  source = next;
}

/** The local calendar day of `date` as YYYY-MM-DD, the key the trend is deduped on. */
export function localDay(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The source's points sorted by date and deduped (the later entry wins),
 * with today's point appended, or replacing an entry for the same day.
 * With no source installed this is just `[today]`.
 */
export function useHealthTrend(today: HealthTrendPoint): HealthTrendPoint[] {
  const { date, counts } = today;
  // Callers rebuild the counts object each render, so the memo keys on its values.
  const key = `${date}:${HEALTH_CHECKS.map((k) => String(counts[k])).join(",")}`;
  return useMemo(() => {
    const [day = ""] = key.split(":");
    const byDate = new Map<string, HealthCounts>();
    for (const p of source?.() ?? []) byDate.set(p.date, p.counts);
    byDate.set(day, { ...counts });
    return [...byDate.entries()]
      .map(([d, c]) => ({ date: d, counts: c }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
