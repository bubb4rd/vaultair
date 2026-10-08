import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DeviceMobileIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  IdentificationBadgeIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { PAGE_PATHS, getNavLabel } from "@/app/nav";
import { useIdentitiesChanged, useIdentityOverview, useIdentityUpdated } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accountType, formatDate } from "@/features/accounts/labels";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import {
  identities,
  toIpcError,
  type ContactPointView,
  type IdentityDetail,
  type IdentityOverview,
  type OverviewAccount,
} from "@/ipc/client";
import { plural } from "./IdentitiesPage";
import { IdentityAvatar } from "./IdentityAvatar";
import { AssignAccountsDialog, DeleteIdentityDialog } from "./IdentityDialogs";
import { RecoveryDependencies } from "./RecoveryDependencies";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="text-[13px] break-words text-foreground">
        {children ?? <span className="text-subtle-foreground">Not set</span>}
      </dd>
    </div>
  );
}

function Chips({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return <span className="text-subtle-foreground">None</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((t) => (
        <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Left column: who this identity is. */
function Summary({ overview }: { overview: IdentityOverview }) {
  const identity = overview.identity;
  return (
    <aside aria-label="Identity summary" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <IdentityAvatar name={identity.name} color={identity.color} size="lg" />
        <div className="min-w-0 pt-0.5">
          <p className="text-[15px] font-semibold break-words">{identity.name}</p>
          <p className="text-[13px] text-muted-foreground">{plural(overview.accountCount, "account")}</p>
        </div>
      </div>
      {identity.description && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{identity.description}</p>
      )}
      <dl className="flex flex-col gap-4">
        <Meta label="Primary email">{identity.primaryEmail}</Meta>
        <Meta label="Recovery email">{identity.recoveryEmail}</Meta>
        <Meta label="Phone">{identity.phoneRef}</Meta>
        <Meta label="Platforms">
          <Chips items={overview.platforms} label="Platforms used" />
        </Meta>
        <Meta label="Tags">
          <Chips items={identity.tags} label="Tags" />
        </Meta>
        {identity.notes && (
          <Meta label="Notes">
            <span className="whitespace-pre-wrap">{identity.notes}</span>
          </Meta>
        )}
        <Meta label="Added">{formatDate(identity.createdAt)}</Meta>
        <Meta label="Last edited">{formatDate(identity.updatedAt)}</Meta>
      </dl>
    </aside>
  );
}

function Panel({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card px-4 pt-3 pb-1">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id={id} className="text-[13px] font-semibold">
            {title}
          </h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function AccountLine({ account, onRemove }: { account: OverviewAccount; onRemove: () => void }) {
  const type = accountType(account.accountType);
  const Icon = type.icon;
  return (
    <li className="group flex items-center gap-3 py-2">
      <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border-strong text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to="/accounts/$accountId"
          params={{ accountId: account.id }}
          className="block truncate rounded-sm text-[13px] text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {account.title}
        </Link>
        <p className="text-xs text-muted-foreground">{account.purposeName}</p>
      </div>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${account.title} from this identity`}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={onRemove}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Remove from identity</TooltipContent>
      </Tooltip>
    </li>
  );
}

function ContactLine({ contact, detail }: { contact: ContactPointView; detail: ReactNode }) {
  const Icon = contact.kind === "phone" ? DeviceMobileIcon : EnvelopeSimpleIcon;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] break-all text-foreground">{contact.value}</p>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {contact.accountCount > 1 && (
        <StatusBadge status="linked" label={`Shared by ${String(contact.accountCount)}`} />
      )}
    </li>
  );
}

function Detail({ overview }: { overview: IdentityOverview }) {
  const navigate = useNavigate();
  const updated = useIdentityUpdated();
  const changed = useIdentitiesChanged();
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const identity = overview.identity;
  const archived = identity.archivedAt !== null;

  function run(action: () => Promise<IdentityDetail>, success: string) {
    action()
      .then((d) => {
        updated(d);
        toast.success(success, { description: d.name });
      })
      .catch((err: unknown) => {
        toast.error("That didn't work", { description: toIpcError(err).message });
      });
  }

  function unassign(account: OverviewAccount) {
    identities
      .assignAccounts(null, [account.id])
      .then(() => {
        changed();
        toast.success("Removed from identity", { description: account.title });
      })
      .catch((err: unknown) => {
        toast.error("Couldn't remove it", { description: toIpcError(err).message });
      });
  }

  const assignButton = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={() => {
        setAssigning(true);
      }}
    >
      <PlusIcon aria-hidden="true" />
      Assign accounts
    </Button>
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Vault", to: "/" },
          { label: getNavLabel(PAGE_PATHS.identities), to: PAGE_PATHS.identities },
          { label: identity.name },
        ]}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm">
              <Link to="/identities/$identityId/edit" params={{ identityId: identity.id }}>
                <PencilSimpleIcon aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions">
                  <DotsThreeIcon aria-hidden="true" weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {archived ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      run(() => identities.unarchive(identity.id), "Identity restored");
                    }}
                  >
                    <ArrowCounterClockwiseIcon aria-hidden="true" />
                    Restore from archive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => {
                      run(() => identities.archive(identity.id), "Identity archived");
                    }}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setDeleting(true);
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                  Delete permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        {archived && (
          <div className="mb-6 flex max-w-6xl items-center gap-3 rounded-lg border border-border-strong bg-muted/50 px-4 py-2.5">
            <ArchiveIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <p className="flex-1 text-[13px] text-muted-foreground">
              Archived {formatDate(identity.archivedAt)}. Its accounts keep it, but it's left out of pickers and
              filters.
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                run(() => identities.unarchive(identity.id), "Identity restored");
              }}
            >
              Restore
            </Button>
          </div>
        )}
        <div className="grid max-w-6xl grid-cols-[240px_minmax(0,1fr)] gap-8">
          <Summary overview={overview} />
          <div className="flex min-w-0 flex-col gap-5">
            <Panel id="accounts-heading" title="Accounts" actions={assignButton}>
              {overview.groups.length === 0 ? (
                <p className="py-3 text-[13px] text-subtle-foreground">
                  No accounts yet. Assign existing ones, or pick this identity when you add an account.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {overview.groups.map((g) => {
                    const name = g.platform ?? "No platform";
                    return (
                      <div key={name} className="py-2">
                        <h3 className="pt-1 text-xs font-medium text-subtle-foreground">
                          {name} <span className="font-normal">· {g.accounts.length}</span>
                        </h3>
                        <ul aria-label={`${name} accounts`}>
                          {g.accounts.map((a) => (
                            <AccountLine
                              key={a.id}
                              account={a}
                              onRemove={() => {
                                unassign(a);
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <RecoveryDependencies dependencies={overview.dependencies} />

            <Panel
              id="emails-heading"
              title="Emails"
              description="What this identity's accounts sign in and recover with. Shared means other accounts in the vault use it too."
            >
              {overview.sharedEmails.length === 0 ? (
                <p className="py-3 text-[13px] text-subtle-foreground">No emails on these accounts yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.sharedEmails.map((e) => (
                    <ContactLine
                      key={e.contact.id}
                      contact={e.contact}
                      detail={e.accounts.map((a) => a.title).join(", ")}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              id="recovery-heading"
              title="Recovery methods"
              description="Recovery emails and phones set on its accounts."
            >
              {overview.recoveryMethods.length === 0 ? (
                <p className="py-3 text-[13px] text-subtle-foreground">
                  None recorded. Add a recovery email or phone when you edit an account.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.recoveryMethods.map((c) => (
                    <ContactLine
                      key={c.id}
                      contact={c}
                      detail={c.kind === "phone" ? "Recovery phone" : "Recovery email"}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
      <AssignAccountsDialog
        identity={identity}
        open={assigning}
        onOpenChange={setAssigning}
        onAssigned={() => {
          changed();
        }}
      />
      <DeleteIdentityDialog
        identity={identity}
        accountCount={overview.accountCount}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => {
          changed(identity.id);
          void navigate({ to: PAGE_PATHS.identities });
        }}
      />
    </>
  );
}

export function IdentityDetailPage({ identityId }: { identityId: string }) {
  const overview = useIdentityOverview(identityId);
  const fallbackCrumbs = [
    { label: "Vault", to: "/" },
    { label: getNavLabel(PAGE_PATHS.identities), to: PAGE_PATHS.identities },
    { label: "Identity" },
  ];
  if (overview.isPending || !overview.data) return <PageHeader crumbs={fallbackCrumbs} />;
  if (overview.isError) {
    return (
      <>
        <PageHeader crumbs={fallbackCrumbs} />
        <div className="px-6">
          <EmptyState icon={IdentificationBadgeIcon} title="Identity not found" description="It may have been deleted.">
            <Button asChild variant="outline" size="sm">
              <Link to={PAGE_PATHS.identities}>Back to identities</Link>
            </Button>
          </EmptyState>
        </div>
      </>
    );
  }
  return <Detail overview={overview.data} />;
}

