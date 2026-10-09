import { PAGE_PATHS } from "@/app/nav";
import type { DashboardSummary, IdentityRef } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { MoreLink, bigNumber, number, sectionTitle } from "./bits";

type Check = "weak" | "reused" | "missingMfa" | "missingRecoveryCodes" | "dormant";

/** The five checks in severity order. Class names are spelled out so Tailwind can find them. */
const CHECKS: { key: Check; label: string; swatch: string }[] = [
  { key: "weak", label: "Weak passwords", swatch: "bg-status-risk" },
  { key: "reused", label: "Reused passwords", swatch: "bg-status-risk" },
  { key: "missingMfa", label: "Missing MFA", swatch: "bg-status-warning" },
  { key: "missingRecoveryCodes", label: "Missing recovery codes", swatch: "bg-status-attention" },
  { key: "dormant", label: "Dormant", swatch: "bg-status-dormant" },
];

/** Today's open issues across the five checks, computed live by Rust. */
export function SecurityHealth({ summary: s, filtered }: { summary: DashboardSummary; filtered: IdentityRef | undefined }) {
  const total = CHECKS.reduce((n, c) => n + s[c.key], 0);
  return (
    <section aria-labelledby="dashboard-health" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dashboard-health" className={sectionTitle}>
          Security health
        </h2>
        <MoreLink to={PAGE_PATHS.health}>Open Security Health</MoreLink>
      </div>
      {s.totalAccounts === 0 ? (
        <p className="text-[13px] text-muted-foreground">No accounts yet</p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className={bigNumber}>{number.format(total)}</span>
            <span className="text-[13px] text-muted-foreground">{total === 1 ? "open issue" : "open issues"}</span>
          </p>
          <ul aria-label="Open issues by check" className="flex flex-col gap-1.5 text-xs">
            {CHECKS.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span aria-hidden="true" className={cn("size-2 rounded-[2px]", s[c.key] > 0 ? c.swatch : "bg-muted")} />
                <span className={s[c.key] > 0 ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                <span className="ml-auto font-medium text-foreground tabular-nums">{number.format(s[c.key])}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Today, across {filtered ? `${filtered.name} accounts` : "all active accounts"}. An account with more than one issue counts once per check.
          </p>
        </>
      )}
    </section>
  );
}
