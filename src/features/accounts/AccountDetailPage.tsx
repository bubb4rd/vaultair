import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PAGE_PATHS } from "@/app/nav";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CopySimpleIcon,
  DotsThreeIcon,
  KeyIcon,
  LightbulbIcon,
  PencilSimpleIcon,
  SealCheckIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useAccount, useAccountRemoved, useAccountUpdated, useHealthIssues } from "@/app/queries";
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
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { FixLink } from "@/features/health/FixLink";
import { ruleLabel, severityStatus } from "@/features/health/labels";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import { accounts, toIpcError, type AccountDetail, type AccountUrl } from "@/ipc/client";
import { DeleteConfirmDialog, OpenUrlDialog } from "./ConfirmDialogs";
import { GameProfilesSection } from "./GameProfilesSection";
import { suggestionLines } from "./notesHints";
import { MfaSection } from "./MfaSection";
import { CopyButton, FieldRow, SecretField } from "./SecretField";
import { accountType, displayStatus, formatDate, passwordStrength } from "./labels";

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card px-4 pt-3 pb-2">
      <h2 id={id} className="pb-1 text-[13px] font-semibold">
        {title}
      </h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

/** Left column: what the account is, at a glance. */
function Summary({ account, onVerify }: { account: AccountDetail; onVerify: () => void }) {
  const type = accountType(account.accountType);
  const status = displayStatus(account);
  const subtitle = [type.label, account.platformName ?? account.gameName ?? account.publisher].filter(Boolean).join(" · ");
  return (
    <aside aria-label="Account summary" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <AccountLogo account={account} size="lg" />
        <div className="min-w-0 pt-0.5">
          <p className="text-[15px] font-semibold break-words">{account.title}</p>
          <p className="text-[13px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <dl className="flex flex-col gap-4">
        <Meta label="Status">
          <span className="flex flex-col items-start gap-1">
            <StatusBadge status={status.badge} label={status.label} />
            <span className="text-xs text-subtle-foreground">{status.activity}</span>
          </span>
        </Meta>
        <Meta label="Identity">
          {account.identityId && account.identityName ? (
            <Link
              to="/identities/$identityId"
              params={{ identityId: account.identityId }}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {account.identityName}
            </Link>
          ) : (
            <span className="text-subtle-foreground">None</span>
          )}
        </Meta>
        <Meta label="Purpose">{account.purposeName}</Meta>
        {account.platformName && <Meta label="Platform">{account.platformName}</Meta>}
        {account.gameName && <Meta label="Game">{account.gameName}</Meta>}
        <Meta label="Tags">
          {account.tags.length === 0 ? (
            <span className="text-subtle-foreground">None</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {account.tags.map((t) => (
                <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </Meta>
        <Meta label="Last verified">
          <span className="flex flex-col items-start gap-1.5">
            <span className={account.lastVerifiedAt ? "" : "text-subtle-foreground"}>
              {formatDate(account.lastVerifiedAt) ?? "Never"}
            </span>
            <Button type="button" variant="outline" size="xs" onClick={onVerify}>
              <SealCheckIcon aria-hidden="true" />
              Mark verified
            </Button>
          </span>
        </Meta>
        <Meta label="Added">{formatDate(account.createdAt)}</Meta>
        <Meta label="Last edited">{formatDate(account.updatedAt)}</Meta>
      </dl>
    </aside>
  );
}

function UrlRow({
  label,
  url,
  note,
  onOpen,
}: {
  label: string;
  url: string | null;
  note?: string | undefined;
  onOpen: () => void;
}) {
  return (
    <FieldRow
      label={label}
      actions={
        url && (
          <Button type="button" variant="outline" size="xs" onClick={onOpen}>
            <ArrowSquareOutIcon aria-hidden="true" />
            Open
          </Button>
        )
      }
    >
      {url && (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-xs break-all">{url}</span>
          {note && <span className="text-xs text-subtle-foreground">{note}</span>}
        </span>
      )}
    </FieldRow>
  );
}

/**
 * Suggests moving account details out of the sensitive notes into their own
 * fields (ADR-0006). The flags come from Rust, set when the notes were
 * saved; nothing here reads the notes. Declining keeps them as they are.
 */
function NotesSuggestion({ account }: { account: AccountDetail }) {
  const updated = useAccountUpdated();
  const lines = suggestionLines(account.notesSuggestions);
  if (!account.hasSensitiveNotes || lines.length === 0) return null;

  function keep() {
    accounts
      .dismissNotesSuggestions(account.id)
      .then(updated)
      .catch((err: unknown) => {
        toast.error("That didn't work", { description: toIpcError(err).message });
      });
  }

  return (
    <section
      aria-labelledby="notes-suggestion-heading"
      className="flex gap-3 rounded-lg border border-status-linked/40 bg-status-linked/8 px-4 py-3"
    >
      <LightbulbIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-linked" weight="bold" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id="notes-suggestion-heading" className="text-[13px] font-medium">
          Your sensitive notes may hold details that have their own field
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-muted-foreground">
          {lines.map((l) => (
            <li key={l.key}>{l.text}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="xs">
            <Link to="/accounts/$accountId/edit" params={{ accountId: account.id }}>
              Edit account
            </Link>
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={keep}>
            Keep in notes
          </Button>
        </div>
      </div>
    </section>
  );
}

function Security({ account }: { account: AccountDetail }) {
  const strength = account.passwordStrength === null ? null : passwordStrength(account.passwordStrength);
  const enabled = account.mfa.filter((m) => m.enabled);
  const codes = enabled.reduce((n, m) => n + m.backupCodesRemaining, 0);
  const issues = useHealthIssues(null, null, account.archivedAt === null);
  const mine = account.archivedAt ? [] : (issues.data ?? []).filter((issue) => issue.accountId === account.id);
  return (
    <Panel id="security-heading" title="Security">
      <FieldRow label="Password">
        {strength ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={strength.status} label={strength.label} />
            {account.passwordChangedAt && (
              <span className="text-xs text-subtle-foreground">Changed {formatDate(account.passwordChangedAt)}</span>
            )}
          </span>
        ) : (
          <StatusBadge status="unknown" label="No password saved" />
        )}
      </FieldRow>
      <FieldRow label="MFA">
        {enabled.length > 0 ? (
          <StatusBadge status="secure" label="On" />
        ) : (
          <StatusBadge status="warning" label={account.mfa.length > 0 ? "Turned off" : "Not recorded"} />
        )}
      </FieldRow>
      <FieldRow label="Backup codes">
        {enabled.length === 0 ? null : codes > 0 ? (
          `${String(codes)} left`
        ) : (
          <StatusBadge status="attention" label="None saved" />
        )}
      </FieldRow>
      {mine.map((issue) => (
        <FieldRow
          key={issue.rule}
          label={ruleLabel(issue.rule)}
          actions={issue.fix === "account" ? undefined : <FixLink issue={issue} />}
        >
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={severityStatus(issue.severity)} />
            <span>{issue.reason}</span>
          </span>
        </FieldRow>
      ))}
    </Panel>
  );
}

function Detail({ account }: { account: AccountDetail }) {
  const navigate = useNavigate();
  const updated = useAccountUpdated();
  const removed = useAccountRemoved();
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState<AccountUrl | null>(null);
  const archived = account.archivedAt !== null;

  function run(action: () => Promise<AccountDetail>, success: string) {
    action()
      .then((d) => {
        updated(d);
        toast.success(success, { description: d.title });
      })
      .catch((err: unknown) => {
        toast.error("That didn't work", { description: toIpcError(err).message });
      });
  }

  function duplicate() {
    accounts
      .duplicateAsTemplate(account.id)
      .then((d) => {
        updated(d);
        toast.success("Alt template created", { description: "Add its username and password." });
        void navigate({ to: "/accounts/$accountId/edit", params: { accountId: d.id } });
      })
      .catch((err: unknown) => {
        toast.error("Couldn't duplicate it", { description: toIpcError(err).message });
      });
  }

  const hasGameDetails = Boolean(account.region ?? account.playerId ?? account.displayName ?? account.publisher);

  return (
    <>
      <PageHeader
        title={account.title}
        actions={
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={account.favorite}
                  aria-label={account.favorite ? "Remove from favorites" : "Add to favorites"}
                  onClick={() => {
                    accounts
                      .setFavorite(account.id, !account.favorite)
                      .then(updated)
                      .catch((err: unknown) => {
                        toast.error("Couldn't update favorites", { description: toIpcError(err).message });
                      });
                  }}
                >
                  <StarIcon
                    aria-hidden="true"
                    weight={account.favorite ? "fill" : "regular"}
                    className={account.favorite ? "text-status-attention" : undefined}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{account.favorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
            </Tooltip>
            <Button asChild variant="outline" size="sm">
              <Link to="/accounts/$accountId/edit" params={{ accountId: account.id }}>
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
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={duplicate}>
                  <CopySimpleIcon aria-hidden="true" />
                  Duplicate as alt template
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    run(() => accounts.markVerified(account.id), "Marked as verified");
                  }}
                >
                  <SealCheckIcon aria-hidden="true" />
                  Mark verified
                </DropdownMenuItem>
                {archived ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      run(() => accounts.unarchive(account.id), "Account restored");
                    }}
                  >
                    <ArrowCounterClockwiseIcon aria-hidden="true" />
                    Restore from archive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => {
                      run(() => accounts.archive(account.id), "Account archived");
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
              Archived {formatDate(account.archivedAt)}. It's left out of lists and security checks.
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                run(() => accounts.unarchive(account.id), "Account restored");
              }}
            >
              Restore
            </Button>
          </div>
        )}
        <div className="grid max-w-6xl grid-cols-[240px_minmax(0,1fr)] gap-8">
          <Summary
            account={account}
            onVerify={() => {
              run(() => accounts.markVerified(account.id), "Marked as verified");
            }}
          />
          <div className="flex min-w-0 flex-col gap-5">
            <Panel id="signin-heading" title="Sign-in">
              <FieldRow label="Username" actions={account.username && <CopyButton text={account.username} label="Username" />}>
                {account.username}
              </FieldRow>
              <FieldRow label="Email" actions={account.email && <CopyButton text={account.email} label="Email" />}>
                {account.email}
              </FieldRow>
              {account.hasPassword ? (
                <SecretField label="Password" target={{ kind: "accountPassword", id: account.id }} />
              ) : (
                <FieldRow label="Password" />
              )}
              <FieldRow
                label="Recovery email"
                actions={account.recoveryEmail && <CopyButton text={account.recoveryEmail} label="Recovery email" />}
              >
                {account.recoveryEmail}
              </FieldRow>
              <FieldRow label="Recovery phone">{account.recoveryPhone}</FieldRow>
              <UrlRow
                label="Login page"
                url={account.loginUrl ?? account.catalogLoginUrl}
                note={
                  account.loginUrl
                    ? undefined
                    : `From the ${account.platformName ?? "platform"} catalog entry, not saved on this account.`
                }
                onOpen={() => {
                  setOpening("login");
                }}
              />
              <UrlRow
                label="Website"
                url={account.websiteUrl}
                onOpen={() => {
                  setOpening("website");
                }}
              />
            </Panel>

            <MfaSection account={account} />

            <Security account={account} />

            <GameProfilesSection account={account} />

            {hasGameDetails && (
              <Panel id="game-heading" title="Game details">
                <FieldRow label="Publisher">{account.publisher}</FieldRow>
                <FieldRow label="Region">{account.region}</FieldRow>
                <FieldRow
                  label="Player ID"
                  actions={account.playerId && <CopyButton text={account.playerId} label="Player ID" />}
                >
                  {account.playerId}
                </FieldRow>
                <FieldRow label="Display name">{account.displayName}</FieldRow>
              </Panel>
            )}

            {account.customFields.length > 0 && (
              <Panel id="custom-heading" title="Custom fields">
                {account.customFields.map((f) =>
                  f.fieldType === "secret" ? (
                    f.hasValue ? (
                      <SecretField key={f.id} label={f.label} target={{ kind: "customField", id: f.id }} />
                    ) : (
                      <FieldRow key={f.id} label={f.label} />
                    )
                  ) : (
                    <FieldRow
                      key={f.id}
                      label={f.label}
                      actions={f.value && <CopyButton text={f.value} label={f.label} />}
                    >
                      {f.value}
                    </FieldRow>
                  ),
                )}
              </Panel>
            )}

            <Panel id="notes-heading" title="Notes">
              <FieldRow label="Notes">
                {account.notes && <span className="whitespace-pre-wrap">{account.notes}</span>}
              </FieldRow>
              {account.hasSensitiveNotes ? (
                <SecretField label="Sensitive notes" multiline target={{ kind: "sensitiveNotes", id: account.id }} />
              ) : (
                <FieldRow label="Sensitive notes" />
              )}
            </Panel>

            <NotesSuggestion account={account} />
          </div>
        </div>
      </div>
      <DeleteConfirmDialog
        account={account}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => {
          removed(account.id);
          void navigate({ to: archived ? PAGE_PATHS.archived : PAGE_PATHS.accounts });
        }}
      />
      {opening && (
        <OpenUrlDialog
          accountId={account.id}
          which={opening}
          open
          onOpenChange={(open) => {
            if (!open) setOpening(null);
          }}
        />
      )}
    </>
  );
}

export function AccountDetailPage({ accountId }: { accountId: string }) {
  const account = useAccount(accountId);
  if (account.isPending) return <PageHeader title="Account" />;
  if (account.isError) {
    return (
      <>
        <PageHeader title="Account" />
        <div className="px-6">
          <EmptyState icon={KeyIcon} title="Account not found" description="It may have been deleted.">
            <Button asChild variant="outline" size="sm">
              <Link to={PAGE_PATHS.accounts}>Back to all accounts</Link>
            </Button>
          </EmptyState>
        </div>
      </>
    );
  }
  return <Detail account={account.data} />;
}
