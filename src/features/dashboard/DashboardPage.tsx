import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { IdentificationBadgeIcon, KeyIcon, PlusIcon, SquaresFourIcon, StarIcon } from "@phosphor-icons/react";
import { useDashboardSummary, useIdentityRefs } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/textarea";
import { accountType, formatRelative } from "@/features/accounts/labels";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import { PageHeader } from "@/features/shell/PageHeader";
import type { DashboardSummary } from "@/ipc/client";
import { useIdentityFilter } from "./useIdentityFilter";

const number = new Intl.NumberFormat();

/** A stat tile: sentence-case label, the value, and a status line only when it matters. */
function Tile({ label, value, note }: { label: string; value: number; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-col items-start gap-2">
        <span className="text-2xl font-semibold tracking-[-0.02em] text-foreground">{number.format(value)}</span>
        {note}
      </dd>
    </div>
  );
}

function IdentityFilter() {
  const refs = useIdentityRefs();
  const [identityId, setIdentityId] = useIdentityFilter();
  if (!refs.data || refs.data.length === 0) return null;
  return (
    <div className="w-48">
      <NativeSelect
        aria-label="Filter by identity"
        className="h-7 text-[13px]"
        value={identityId ?? ""}
        onChange={(e) => {
          setIdentityId(e.target.value || null);
        }}
      >
        <option value="">All identities</option>
        {refs.data.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function Recent({ summary }: { summary: DashboardSummary }) {
  return (
    <section aria-labelledby="recent-heading" className="rounded-lg border border-border bg-card px-4 pt-3 pb-1">
      <h2 id="recent-heading" className="pb-1 text-[13px] font-semibold">
        Recently edited
      </h2>
      <ul className="divide-y divide-border">
        {summary.recent.map((a) => {
          const Icon = accountType(a.accountType).icon;
          return (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border-strong text-muted-foreground">
                <Icon aria-hidden="true" className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to="/accounts/$accountId"
                  params={{ accountId: a.id }}
                  className="block truncate rounded-sm text-[13px] text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {a.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {a.identityName ? `${a.purposeName} · ${a.identityName}` : a.purposeName}
                </p>
              </div>
              {a.favorite && (
                <StarIcon aria-label="Favorite" weight="fill" className="size-3.5 text-status-attention" />
              )}
              <span className="text-xs whitespace-nowrap text-subtle-foreground">{formatRelative(a.updatedAt)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuickActions() {
  return (
    <section aria-labelledby="actions-heading" className="flex flex-col gap-2">
      <h2 id="actions-heading" className="text-[13px] font-semibold">
        Quick actions
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/accounts/new">
            <PlusIcon aria-hidden="true" />
            Add account
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/identities/new">
            <IdentificationBadgeIcon aria-hidden="true" />
            Add identity
          </Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The vault at a glance, for everything or one identity. Security health
 * (weak and reused passwords, attention items) joins it in Phase 12.
 */
export function DashboardPage() {
  const [identityId] = useIdentityFilter();
  const refs = useIdentityRefs();
  const summary = useDashboardSummary(identityId);
  const filtered = identityId !== null ? refs.data?.find((r) => r.id === identityId) : undefined;

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
          description="Once you add accounts, this page counts them by purpose and identity and shows what needs attention, such as accounts without MFA."
        >
          <QuickActions />
        </EmptyState>
      );
    } else {
      body = (
        <div className="flex max-w-6xl flex-col gap-6">
          {filtered && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Showing <IdentityChip name={filtered.name} color={filtered.color} />
              <span>only.</span>
            </p>
          )}
          <dl aria-label="Vault summary" className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            <Tile label="Accounts" value={s.totalAccounts} />
            <Tile label="Main accounts" value={s.mainAccounts} />
            <Tile label="Alt accounts" value={s.altAccounts} />
            <Tile label={identityId ? "Identity" : "Identities"} value={s.identities} />
            <Tile
              label="Without MFA"
              value={s.missingMfa}
              note={
                s.missingMfa > 0 ? (
                  <StatusBadge status="warning" label="Needs MFA" />
                ) : s.totalAccounts > 0 ? (
                  <StatusBadge status="secure" label="All covered" />
                ) : undefined
              }
            />
            <Tile label="Favorites" value={s.favorites} />
          </dl>
          <div className="grid grid-cols-[minmax(0,1fr)_240px] items-start gap-6">
            {s.recent.length > 0 ? (
              <Recent summary={s} />
            ) : (
              <p className="text-[13px] text-muted-foreground">No accounts in this identity yet.</p>
            )}
            <QuickActions />
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
