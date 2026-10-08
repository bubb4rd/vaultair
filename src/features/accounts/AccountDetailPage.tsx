import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PAGE_PATHS, getNavLabel } from "@/app/nav";
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
  TrashIcon,
} from "@phosphor-icons/react";
import { useAccount, useAccountRemoved, useAccountUpdated, useSessionConfig } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import { accounts, toIpcError, type AccountDetail, type AccountUrl } from "@/ipc/client";
import { AccountHeader } from "./AccountHeader";
import { DeleteConfirmDialog, OpenUrlDialog } from "./ConfirmDialogs";
import { GameProfilesSection } from "./GameProfilesSection";
import { suggestionLines } from "./notesHints";
import { MfaSection } from "./MfaSection";
import { ConcealedField, CopyButton, FieldRow, IconAction, SecretField } from "./SecretField";
import { SecurityCard } from "./SecurityCard";
import { formatDate } from "./labels";

/** Email and recovery email. Masked when the privacy setting is on. */
function EmailField({ label, value }: { label: string; value: string | null }) {
  const hide = useSessionConfig().data?.hideEmails ?? false;
  if (hide && value) return <ConcealedField label={label} value={value} />;
  return (
    <FieldRow label={label} actions={value ? <CopyButton text={value} label={label} /> : undefined}>
      {value}
    </FieldRow>
  );
}

/** A heading over label / value rows. No box: the rows' hairlines are the structure. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="text-[13px] font-semibold">
        {title}
      </h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
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
          <IconAction label={`Open ${label.toLowerCase()}`} onClick={onOpen}>
            <ArrowSquareOutIcon aria-hidden="true" />
          </IconAction>
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

  function verify() {
    run(() => accounts.markVerified(account.id), "Marked as verified");
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
  const parent = account.archivedAt
    ? { label: getNavLabel(PAGE_PATHS.archived), to: PAGE_PATHS.archived }
    : { label: getNavLabel(PAGE_PATHS.accounts), to: PAGE_PATHS.accounts };

  const actions = (
    <>
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
          <DropdownMenuItem onSelect={verify}>
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
    </>
  );

  return (
    <>
      <PageHeader crumbs={[{ label: "Vault", to: "/" }, parent, { label: account.title }]} />
      <div className="@container min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-6xl flex-col gap-6">
          {archived && (
            <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-muted/50 px-4 py-2.5">
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
          <AccountHeader
            account={account}
            actions={actions}
            onFavorite={() => {
              accounts
                .setFavorite(account.id, !account.favorite)
                .then(updated)
                .catch((err: unknown) => {
                  toast.error("Couldn't update favorites", { description: toIpcError(err).message });
                });
            }}
          />
          <div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-8">
              <Section id="signin-heading" title="Sign-in">
                <FieldRow label="Username" actions={account.username && <CopyButton text={account.username} label="Username" />}>
                  {account.username}
                </FieldRow>
                <EmailField label="Email" value={account.email} />
                {account.hasPassword ? (
                  <SecretField label="Password" target={{ kind: "accountPassword", id: account.id }} />
                ) : (
                  <FieldRow label="Password" />
                )}
                <EmailField label="Recovery email" value={account.recoveryEmail} />
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
              </Section>

              <MfaSection account={account} />

              <GameProfilesSection account={account} />

              {hasGameDetails && (
                <Section id="game-heading" title="Game details">
                  <FieldRow label="Publisher">{account.publisher}</FieldRow>
                  <FieldRow label="Region">{account.region}</FieldRow>
                  <FieldRow
                    label="Player ID"
                    actions={account.playerId && <CopyButton text={account.playerId} label="Player ID" />}
                  >
                    {account.playerId}
                  </FieldRow>
                  <FieldRow label="Display name">{account.displayName}</FieldRow>
                </Section>
              )}

              {account.customFields.length > 0 && (
                <Section id="custom-heading" title="Custom fields">
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
                </Section>
              )}

              <Section id="notes-heading" title="Notes">
                <FieldRow label="Notes">
                  {account.notes && <span className="whitespace-pre-wrap">{account.notes}</span>}
                </FieldRow>
                {account.hasSensitiveNotes ? (
                  <SecretField label="Sensitive notes" multiline target={{ kind: "sensitiveNotes", id: account.id }} />
                ) : (
                  <FieldRow label="Sensitive notes" />
                )}
              </Section>

              <NotesSuggestion account={account} />
            </div>
            <div className="self-start @4xl:sticky @4xl:top-0">
              <SecurityCard account={account} onVerify={verify} />
            </div>
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
  const fallbackCrumbs = [
    { label: "Vault", to: "/" },
    { label: getNavLabel(PAGE_PATHS.accounts), to: PAGE_PATHS.accounts },
    { label: "Account" },
  ];
  if (account.isPending || !account.data) return <PageHeader crumbs={fallbackCrumbs} />;
  if (account.isError) {
    return (
      <>
        <PageHeader crumbs={fallbackCrumbs} />
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
