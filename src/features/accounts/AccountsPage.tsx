import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  FlaskIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { useAccounts, useIdentityRefs, useOpenVault } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/features/shell/PageHeader";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import type { AccountSummary, IdentityColor } from "@/ipc/client";
import { accountStatus, accountType, formatRelative, passwordStrength } from "./labels";

function matches(a: AccountSummary, q: string) {
  if (!q) return true;
  const hay = [a.title, a.username, a.email, a.publisher, a.purposeName, a.identityName, ...a.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** Password strength and MFA at a glance: icon and text, never colour alone. */
function Security({ account }: { account: AccountSummary }) {
  const strength = account.passwordStrength === null ? null : passwordStrength(account.passwordStrength);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {strength && strength.status !== "secure" && <StatusBadge status={strength.status} label={`${strength.label} password`} />}
      {!account.hasPassword && <StatusBadge status="unknown" label="No password" />}
      {account.mfaEnabled ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="size-3.5 text-status-secure" weight="bold" />
          MFA
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldSlashIcon aria-hidden="true" className="size-3.5 text-status-warning" weight="bold" />
          No MFA
        </span>
      )}
    </div>
  );
}

function DemoNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-linked/40 bg-status-linked/8 px-4 py-3">
      <FlaskIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-linked" weight="bold" />
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">Demo vault.</span> These sample accounts use reserved example
        domains and randomly generated passwords. Create a new vault for your real accounts.
      </p>
    </div>
  );
}

function AccountRow({
  account,
  identityColor,
}: {
  account: AccountSummary;
  identityColor: (id: string | null) => IdentityColor | null;
}) {
  const navigate = useNavigate();
  const type = accountType(account.accountType);
  const status = accountStatus(account.status);
  const Icon = type.icon;
  const secondary = account.username ?? account.email;
  return (
    <tr
      className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/60"
      onClick={() => {
        void navigate({ to: "/accounts/$accountId", params: { accountId: account.id } });
      }}
    >
      <td className="py-2.5 pr-4 pl-4">
        <div className="flex items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border-strong bg-card text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                to="/accounts/$accountId"
                params={{ accountId: account.id }}
                className="truncate rounded-sm text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {account.title}
              </Link>
              {account.favorite && (
                <StarIcon aria-label="Favorite" weight="fill" className="size-3.5 shrink-0 text-status-attention" />
              )}
            </div>
            {secondary && <p className="truncate text-xs text-muted-foreground">{secondary}</p>}
          </div>
        </div>
      </td>
      <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">
        {account.identityName ? (
          <IdentityChip name={account.identityName} color={identityColor(account.identityId)} />
        ) : (
          <span className="text-subtle-foreground">None</span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{account.purposeName}</td>
      <td className="py-2.5 pr-4">
        <StatusBadge status={status.badge} label={status.label} />
      </td>
      <td className="py-2.5 pr-4">
        <Security account={account} />
      </td>
      <td className="py-2.5 pr-4 text-right text-xs whitespace-nowrap text-subtle-foreground">
        {formatRelative(account.updatedAt)}
      </td>
    </tr>
  );
}

/**
 * All Accounts, or the Archived list. A filter box narrows by title,
 * username, email, publisher, purpose and tags; full search and saved views
 * arrive in Phase 11.
 */
export function AccountsPage({ archived = false }: { archived?: boolean }) {
  const list = useAccounts(archived);
  const vault = useOpenVault();
  const refs = useIdentityRefs();
  const identityColor = (id: string | null) => refs.data?.find((r) => r.id === id)?.color ?? null;
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (list.data ?? []).filter((a) => matches(a, query.trim())), [list.data, query]);
  const title = archived ? "Archived" : "All Accounts";
  const total = list.data?.length ?? 0;

  const newButton = !archived && (
    <Button asChild size="sm">
      <Link to="/accounts/new">
        <PlusIcon aria-hidden="true" />
        New account
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title={title} actions={newButton} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {list.isPending ? null : list.isError ? (
          <EmptyState icon={KeyIcon} title="Couldn't load accounts" description="Lock and unlock the vault, then try again." />
        ) : total === 0 ? (
          archived ? (
            <EmptyState
              icon={ArchiveIcon}
              title="Nothing archived"
              description="Archived accounts stay in your vault but are left out of lists and security checks."
            />
          ) : (
            <EmptyState
              icon={KeyIcon}
              title="No accounts yet"
              description="Add an account for each login you want to keep track of: game launchers, platforms, email, anything with a password."
            >
              <Button asChild size="sm">
                <Link to="/accounts/new">
                  <PlusIcon aria-hidden="true" />
                  Add your first account
                </Link>
              </Button>
            </EmptyState>
          )
        ) : (
          <div className="flex max-w-6xl flex-col gap-4">
            {vault?.demo && !archived && <DemoNotice />}
            <div className="flex items-center gap-3">
              <div className="relative w-full max-w-sm">
                <MagnifyingGlassIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
                />
                <Input
                  type="search"
                  aria-label={`Filter ${title.toLowerCase()}`}
                  placeholder="Filter by name, email, identity or tag"
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 pl-9"
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
              </div>
              <p className="text-xs text-subtle-foreground" aria-live="polite">
                {rows.length === total
                  ? `${String(total)} ${total === 1 ? "account" : "accounts"}`
                  : `${String(rows.length)} of ${String(total)}`}
              </p>
            </div>
            {rows.length === 0 ? (
              <p className="py-8 text-[13px] text-muted-foreground">No accounts match “{query.trim()}”.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">{title}</caption>
                  <thead>
                    <tr className="border-b border-border text-xs text-subtle-foreground">
                      <th scope="col" className="py-2 pr-4 pl-4 font-medium">
                        Account
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Identity
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Purpose
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Status
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Security
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <AccountRow key={a.id} account={a} identityColor={identityColor} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
