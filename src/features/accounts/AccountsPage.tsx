import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  FlaskIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PasswordIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  StarIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useGames, useIdentityRefs, useOpenVault, usePlatforms } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NativeSelect } from "@/components/ui/textarea";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { copySecret, copyToClipboard } from "@/features/clipboard/copy";
import { PageHeader } from "@/features/shell/PageHeader";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import type { AccountFilter, AccountSummary, GameView, IdentityColor, PlatformView } from "@/ipc/client";
import { displayStatus, passwordStrength } from "./labels";

function matches(a: AccountSummary, q: string) {
  if (!q) return true;
  const hay = [
    a.title,
    a.username,
    a.email,
    a.publisher,
    a.platformName,
    a.gameName,
    a.purposeName,
    a.identityName,
    ...a.tags,
  ]
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

/** An icon button in a row; it doesn't open the account. */
function RowAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Copy the username (or the email, without one) and the password without
 * opening the account. Both go through Rust and clear from the clipboard;
 * the password is never sent to the page. Copying the password counts as
 * activity, so the row's status is refreshed.
 */
function QuickCopy({ account }: { account: AccountSummary }) {
  const queryClient = useQueryClient();
  const login = account.username ?? account.email;
  const loginLabel = account.username ? "username" : "email";
  const gap = <span aria-hidden="true" className="size-7" />;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {login ? (
        <RowAction
          label={`Copy ${loginLabel} for ${account.title}`}
          tip={`Copy ${loginLabel}`}
          onClick={() => void copyToClipboard(login, account.username ? "Username" : "Email")}
        >
          <UserIcon aria-hidden="true" />
        </RowAction>
      ) : (
        gap
      )}
      {account.hasPassword ? (
        <RowAction
          label={`Copy password for ${account.title}`}
          tip="Copy password"
          onClick={() => {
            void copySecret({ kind: "accountPassword", id: account.id }, "Password").then((copied) => {
              if (copied) void queryClient.invalidateQueries({ queryKey: ["accounts"] });
            });
          }}
        >
          <PasswordIcon aria-hidden="true" />
        </RowAction>
      ) : (
        gap
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
  const status = displayStatus(account);
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
          <AccountLogo account={account} />
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
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={status.badge} label={status.label} />
          <span className="text-xs whitespace-nowrap text-subtle-foreground">{status.activity}</span>
        </div>
      </td>
      <td className="py-2.5 pr-4">
        <Security account={account} />
      </td>
      <td className="py-2.5 pr-3">
        <QuickCopy account={account} />
      </td>
    </tr>
  );
}

/** A platform, game or publisher filter. Empty string means "any". */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <NativeSelect
      aria-label={`Filter by ${label.toLowerCase()}`}
      value={value}
      className="h-8 w-auto max-w-44 text-[13px]"
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      <option value="">Any {label.toLowerCase()}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

/**
 * Only what this list uses: the platforms and publishers of its accounts,
 * and games they're for or have a profile in (plus the current choice).
 */
function filterOptions(
  accounts: AccountSummary[],
  platforms: PlatformView[],
  games: GameView[],
  filter: AccountFilter,
  archived: boolean,
) {
    const platformIds = new Set(accounts.map((a) => a.platformId));
  const gameIds = new Set(accounts.map((a) => a.gameId));
  const publishers = new Map<string, string>();
  for (const a of accounts) {
    const p = a.publisher?.trim();
    if (p && !publishers.has(p.toLowerCase())) publishers.set(p.toLowerCase(), p);
  }
  return {
    platforms: platforms
      .filter((p) => platformIds.has(p.id) || p.id === filter.platformId)
      .map((p) => ({ value: p.id, label: p.name }))
      .sort(byLabel),
    games: games
      .filter((g) => gameIds.has(g.id) || (!archived && g.profileCount > 0) || g.id === filter.gameId)
      .map((g) => ({ value: g.id, label: g.name }))
      .sort(byLabel),
    publishers: [...publishers.values()].map((p) => ({ value: p, label: p })).sort(byLabel),
  };
}

/**
 * All Accounts, or the Archived list. Platform, game and publisher filters
 * run in Rust (a game filter also finds accounts with a profile for that
 * game); the text box then narrows by title, username, email, platform,
 * game, publisher, purpose and tags. Full search and saved views arrive in
 * Phase 11.
 */
export function AccountsPage({ archived = false }: { archived?: boolean }) {
  const [filter, setFilter] = useState<AccountFilter>({ platformId: null, gameId: null, publisher: null });
  const filtering = Boolean(filter.platformId ?? filter.gameId ?? filter.publisher);
  const all = useAccounts(archived);
  const filtered = useAccounts(archived, filter);
  const list = filtering ? filtered : all;
  const platforms = usePlatforms();
  const games = useGames();
  const vault = useOpenVault();
  const refs = useIdentityRefs();
  const identityColor = (id: string | null) => refs.data?.find((r) => r.id === id)?.color ?? null;
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (list.data ?? []).filter((a) => matches(a, query.trim())), [list.data, query]);
  const title = archived ? "Archived" : "All Accounts";
  const total = all.data?.length ?? 0;

  const used = filterOptions(all.data ?? [], platforms.data ?? [], games.data ?? [], filter, archived);

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
        {all.isPending ? null : all.isError || list.isError ? (
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
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
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
              {used.platforms.length > 0 && (
                <FilterSelect
                  label="Platform"
                  value={filter.platformId ?? ""}
                  options={used.platforms}
                  onChange={(v) => {
                    setFilter((f) => ({ ...f, platformId: v || null }));
                  }}
                />
              )}
              {used.games.length > 0 && (
                <FilterSelect
                  label="Game"
                  value={filter.gameId ?? ""}
                  options={used.games}
                  onChange={(v) => {
                    setFilter((f) => ({ ...f, gameId: v || null }));
                  }}
                />
              )}
              {used.publishers.length > 0 && (
                <FilterSelect
                  label="Publisher"
                  value={filter.publisher ?? ""}
                  options={used.publishers}
                  onChange={(v) => {
                    setFilter((f) => ({ ...f, publisher: v || null }));
                  }}
                />
              )}
              <p className="ml-1 text-xs text-subtle-foreground" aria-live="polite">
                {list.isPending
                  ? ""
                  : rows.length === total
                    ? `${String(total)} ${total === 1 ? "account" : "accounts"}`
                    : `${String(rows.length)} of ${String(total)}`}
              </p>
            </div>
            {list.isPending ? null : rows.length === 0 ? (
              <p className="py-8 text-[13px] text-muted-foreground">
                {query.trim() ? `No accounts match “${query.trim()}”.` : "No accounts match these filters."}
              </p>
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
                      <th scope="col" className="py-2 pr-3">
                        <span className="sr-only">Quick copy</span>
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
