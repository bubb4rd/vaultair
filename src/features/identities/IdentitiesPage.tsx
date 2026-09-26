import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArchiveIcon, IdentificationBadgeIcon, PlusIcon } from "@phosphor-icons/react";
import { useIdentities } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/PageHeader";
import type { IdentitySummary } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { IdentityAvatar } from "./IdentityAvatar";

export function plural(n: number, one: string, many = `${one}s`) {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function IdentityCard({ identity }: { identity: IdentitySummary }) {
  return (
    <li>
      <Link
        to="/identities/$identityId"
        params={{ identityId: identity.id }}
        className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex items-start gap-3">
          <IdentityAvatar name={identity.name} color={identity.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">{identity.name}</p>
            <p className="truncate text-xs text-muted-foreground">{identity.primaryEmail ?? "No primary email"}</p>
          </div>
        </div>
        {identity.description && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{identity.description}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">{plural(identity.accountCount, "account")}</span>
          {identity.accountsWithoutMfa > 0 && (
            <StatusBadge status="warning" label={`${String(identity.accountsWithoutMfa)} without MFA`} />
          )}
        </div>
      </Link>
    </li>
  );
}

/** Identities as cards, with a switch between active and archived ones. */
export function IdentitiesPage() {
  const [archived, setArchived] = useState(false);
  const list = useIdentities(archived);
  const rows = list.data ?? [];

  const newButton = (
    <Button asChild size="sm">
      <Link to="/identities/new">
        <PlusIcon aria-hidden="true" />
        New identity
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="Identities" actions={newButton} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        <div className="flex max-w-6xl flex-col gap-4">
          <div role="group" aria-label="Show" className="inline-flex w-fit rounded-md border border-border bg-card p-0.5">
            {[
              { value: false, label: "Active" },
              { value: true, label: "Archived" },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                aria-pressed={archived === opt.value}
                className={cn(
                  "h-7 rounded px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  archived === opt.value && "bg-muted font-medium text-foreground",
                )}
                onClick={() => {
                  setArchived(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {list.isPending ? null : list.isError ? (
            <EmptyState
              icon={IdentificationBadgeIcon}
              title="Couldn't load identities"
              description="Lock and unlock the vault, then try again."
            />
          ) : rows.length === 0 ? (
            archived ? (
              <EmptyState
                icon={ArchiveIcon}
                title="No archived identities"
                description="Archived identities keep their accounts but are left out of pickers and filters."
                className="pt-10"
              />
            ) : (
              <EmptyState
                icon={IdentificationBadgeIcon}
                title="No identities yet"
                description="An identity groups the accounts, emails and handles that belong to one persona, such as your main, a competitive profile or a creator channel."
                className="pt-10"
              >
                <Button asChild size="sm">
                  <Link to="/identities/new">
                    <PlusIcon aria-hidden="true" />
                    Create an identity
                  </Link>
                </Button>
              </EmptyState>
            )
          ) : (
            <ul
              aria-label={archived ? "Archived identities" : "Identities"}
              className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3"
            >
              {rows.map((i) => (
                <IdentityCard key={i.id} identity={i} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
