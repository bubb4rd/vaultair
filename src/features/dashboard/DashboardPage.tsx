import type { ReactNode } from "react";
import { KeyIcon, SquaresFourIcon, StarIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { PAGE_PATHS } from "@/app/nav";
import { useDashboardSummary, useIdentityRefs } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { daysSince, formatRelative } from "@/features/accounts/labels";
import { BackupReminder } from "@/features/backup/BackupReminder";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { FixLink } from "@/features/health/FixLink";
import { ruleLabel, severityStatus } from "@/features/health/labels";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import { PageHeader } from "@/features/shell/PageHeader";
import type { AccountSummary, DashboardSummary, HealthIssue } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { AccountGrowth } from "./AccountGrowth";
import { MoreLink, link, number, plural, sectionTitle } from "./bits";
import { IdentityFilter } from "./IdentityFilter";
import { ActionGrid, StatusStrip } from "./StatusStrip";
import { SecurityHealth } from "./SecurityHealth";
import { useIdentityFilter } from "./useIdentityFilter";

/* ------------------------------------------------------------- activity */

type Bucket = "Today" | "Yesterday" | "Earlier";

function bucketOf(iso: string, now: Date): Bucket {
  const d = daysSince(iso, now);
  return d === 0 ? "Today" : d === 1 ? "Yesterday" : "Earlier";
}

function ActivityRow({ account: a }: { account: AccountSummary }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <AccountLogo account={a} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            to="/accounts/$accountId"
            params={{ accountId: a.id }}
            className={cn(link, "truncate text-[13px] text-foreground hover:underline")}
          >
            {a.title}
          </Link>
          {a.favorite && <StarIcon aria-label="Favorite" weight="fill" className="size-3.5 shrink-0 text-status-attention" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {a.identityName ? `${a.purposeName} · ${a.identityName}` : a.purposeName}
        </p>
      </div>
      <time dateTime={a.updatedAt} className="text-xs whitespace-nowrap text-subtle-foreground">
        {formatRelative(a.updatedAt)}
      </time>
    </li>
  );
}

function RecentActivity({ accounts, now }: { accounts: AccountSummary[]; now: Date }) {
  const groups: { label: Bucket; rows: AccountSummary[] }[] = [];
  for (const a of accounts) {
    const label = bucketOf(a.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(a);
    else groups.push({ label, rows: [a] });
  }
  return (
    <section aria-labelledby="dashboard-activity" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dashboard-activity" className={sectionTitle}>
          Recent activity
        </h2>
        <MoreLink to={PAGE_PATHS.accounts}>All accounts</MoreLink>
      </div>
      {accounts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No accounts edited yet.</p>
      ) : (
        <ol aria-label="Recently edited accounts, newest first" className="flex flex-col gap-4">
          {groups.map((g) => (
            <li key={g.label} className="flex flex-col gap-1">
              <h3 className="flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-border-strong" />
                {g.label}
              </h3>
              <ul className="ml-[2.5px] flex flex-col border-l border-border pl-4">
                {g.rows.map((a) => (
                  <ActivityRow key={a.id} account={a} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {accounts.length > 0 && (
        <p className="text-xs text-subtle-foreground">The {plural(accounts.length, "account")} edited most recently.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- right column */

/** The actions with a heading, for the empty state where there is no strip. */
function QuickActions() {
  return (
    <section aria-labelledby="dashboard-actions" className="flex flex-col gap-3">
      <h2 id="dashboard-actions" className={sectionTitle}>
        Quick actions
      </h2>
      {/* Two tiles about 100 px square. */}
      <ActionGrid className="max-w-[208px]" />
    </section>
  );
}

function IssueRow({ issue }: { issue: HealthIssue }) {
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center gap-2">
        <StatusBadge status={severityStatus(issue.severity)} />
        <Link
          to="/accounts/$accountId"
          params={{ accountId: issue.accountId }}
          className={cn(link, "min-w-0 flex-1 truncate text-[13px] text-foreground hover:underline")}
        >
          {issue.title}
        </Link>
        <FixLink issue={issue} />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {ruleLabel(issue.rule)} · {issue.reason}
      </p>
    </li>
  );
}

function NeedsAttention({ summary: s }: { summary: DashboardSummary }) {
  const total = s.weak + s.reused + s.missingMfa + s.missingRecoveryCodes + s.dormant;
  const listed = s.needsAttention;
  return (
    <section aria-labelledby="dashboard-attention" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dashboard-attention" className={sectionTitle}>
          Needs attention
        </h2>
        {total > listed.length && <MoreLink to={PAGE_PATHS.health}>All {number.format(total)}</MoreLink>}
      </div>
      {listed.length === 0 ? (
        <p className="py-2 text-[13px] text-muted-foreground">Nothing needs attention.</p>
      ) : (
        <ul aria-label="Issues, highest severity first" className="divide-y divide-border">
          {listed.map((issue) => (
            <IssueRow key={`${issue.accountId}-${issue.rule}`} issue={issue} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- page */

/**
 * The vault at a glance, for everything or one identity: one status strip
 * across the top (vault split, MFA coverage, the last backup and the quick
 * actions, in a single card divided by hairlines), then account growth over
 * the activity timeline, with today's security health and the open issues
 * beside them.
 */
export function DashboardPage() {
  const [identityId] = useIdentityFilter();
  const refs = useIdentityRefs();
  const summary = useDashboardSummary(identityId);
  const filtered = identityId !== null ? refs.data?.find((r) => r.id === identityId) : undefined;
  const now = new Date();

  let body: ReactNode = null;
  if (summary.isError) {
    body = (
      <EmptyState
        icon={SquaresFourIcon}
        title="Couldn't load the dashboard"
        description="Lock and unlock the vault, then try again."
      />
    );
  } else if (summary.data) {
    const s = summary.data;
    if (s.totalAccounts === 0 && identityId === null) {
      body = (
        <EmptyState
          icon={KeyIcon}
          title="Your vault at a glance"
          description="Once you add accounts, this page shows how they split, how many have MFA, when the last backup ran, how the vault has grown, what needs attention, and what you edited recently."
        >
          <QuickActions />
        </EmptyState>
      );
    } else {
      body = (
        <div className="flex max-w-[1120px] flex-col gap-7">
          <BackupReminder />
          {filtered && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Showing <IdentityChip name={filtered.name} color={filtered.color} />
              <span>only.</span>
            </p>
          )}
          <StatusStrip summary={s} filtered={filtered} now={now} />
          <div className="grid grid-cols-1 gap-x-10 gap-y-8 min-[1000px]:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-8">
              <AccountGrowth summary={s} filtered={filtered} />
              <RecentActivity accounts={s.recent} now={now} />
            </div>
            <aside aria-label="Open issues" className="flex min-w-0 flex-col gap-8">
              <SecurityHealth summary={s} filtered={filtered} />
              <NeedsAttention summary={s} />
            </aside>
          </div>
        </div>
      );
    }
  }

  return (
    <>
      <PageHeader title="Dashboard" actions={<IdentityFilter />} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">{body}</div>
    </>
  );
}
