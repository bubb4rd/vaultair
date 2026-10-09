/**
 * Account growth for the dot chart on the dashboard, from the vault's
 * creation date and each account's `createdAt`.
 *
 * The app keeps no history, so this is all the past the dashboard can show.
 * Deleted accounts leave no trace: every total here is a lower bound.
 */

export interface GrowthDay {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Accounts added that day. */
  added: number;
  /** Accounts added up to and including that day. */
  total: number;
}

/** The local calendar day of `date` as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" as a local date at midnight. */
export function dayDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Every local day from the vault's creation to today, with the accounts
 * added on each and the running total. `accountsCreatedAt` is RFC 3339 in
 * any order. An account dated before the vault (a restored or imported
 * vault) or after today (a clock change) widens the range rather than
 * being dropped.
 */
export function growthDays(vaultCreatedAt: string | null, accountsCreatedAt: readonly string[], today: Date): GrowthDay[] {
  const perDay = new Map<string, number>();
  for (const iso of accountsCreatedAt) {
    const day = localDay(new Date(iso));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const keys = [...perDay.keys(), localDay(today), ...(vaultCreatedAt ? [localDay(new Date(vaultCreatedAt))] : [])].sort();
  const first = keys[0] ?? localDay(today);
  const last = keys[keys.length - 1] ?? first;

  const days: GrowthDay[] = [];
  let total = 0;
  for (let d = dayDate(first); localDay(d) <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const date = localDay(d);
    const added = perDay.get(date) ?? 0;
    total += added;
    days.push({ date, added, total });
  }
  return days;
}
