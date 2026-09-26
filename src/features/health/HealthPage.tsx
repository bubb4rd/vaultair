import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PulseIcon } from "@phosphor-icons/react";
import { useHealthIssues, useHealthSummary, useIdentityRefs } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import { PageHeader } from "@/features/shell/PageHeader";
import type { HealthRule, HealthSummary } from "@/ipc/client";
import { IdentityFilter } from "@/features/dashboard/IdentityFilter";
import { useIdentityFilter } from "@/features/dashboard/useIdentityFilter";
import { FixLink } from "./FixLink";
import { HEALTH_RULES, ruleLabel, severityStatus } from "./labels";

const number = new Intl.NumberFormat();

function countOf(summary: HealthSummary, rule: HealthRule): number {
  switch (rule) {
    case "weak":
      return summary.weak;
    case "reused":
      return summary.reused;
    case "missing_mfa":
      return summary.missingMfa;
    case "missing_recovery_codes":
      return summary.missingRecoveryCodes;
    case "dormant":
      return summary.dormant;
  }
}

/**
 * Weak and reused passwords, missing MFA, missing recovery codes, and dormant
 * accounts. Archived accounts are left out. Choosing a count shows only that rule.
 */
export function HealthPage() {
  const [identityId] = useIdentityFilter();
  const refs = useIdentityRefs();
  const [rule, setRule] = useState<HealthRule | null>(null);
  const summary = useHealthSummary(identityId);
  const issues = useHealthIssues(identityId, rule);
  const filtered = identityId !== null ? refs.data?.find((r) => r.id === identityId) : undefined;

  let body: ReactNode = null;
  if (summary.isError || issues.isError) {
    body = (
      <EmptyState
        icon={PulseIcon}
        title="Couldn't load security health"
        description="Lock and unlock the vault, then try again."
      />
    );
  } else if (summary.data && issues.data) {
    const s = summary.data;
    const rows = issues.data;
    const total = s.weak + s.reused + s.missingMfa + s.missingRecoveryCodes + s.dormant;
    body = (
      <div className="flex max-w-3xl flex-col gap-6">
        {filtered && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Showing <IdentityChip name={filtered.name} color={filtered.color} />
            <span>only.</span>
          </p>
        )}
        <div role="group" aria-label="Health checks" className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {HEALTH_RULES.map((item) => {
            const pressed = rule === item;
            const value = countOf(s, item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={pressed}
                className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card px-4 py-3.5 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-border-strong"
                onClick={() => {
                  setRule(pressed ? null : item);
                }}
              >
                <span className="text-xs text-muted-foreground">{ruleLabel(item)}</span>
                <span className="text-2xl font-semibold tracking-[-0.02em] text-foreground">{number.format(value)}</span>
              </button>
            );
          })}
        </div>
        {total === 0 ? (
          <EmptyState
            icon={PulseIcon}
            title="Nothing to fix"
            description="Every active account has a password that isn't weak or reused, MFA with backup codes saved, and recent activity. Archived accounts aren't checked."
          />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No accounts match this check.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
            {rows.map((issue) => (
              <li key={`${issue.accountId}-${issue.rule}`} className="flex items-center gap-3 py-3">
                <StatusBadge status={severityStatus(issue.severity)} />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/accounts/$accountId"
                    params={{ accountId: issue.accountId }}
                    className="block truncate rounded-sm text-[13px] text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {issue.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {ruleLabel(issue.rule)} · {issue.reason}
                  </p>
                </div>
                <FixLink issue={issue} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Security Health" actions={<IdentityFilter />} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">{body}</div>
    </>
  );
}
