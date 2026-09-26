import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AppWindowIcon, CaretDownIcon, GameControllerIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useAccounts, useGameProfiles, useGames, usePlatforms } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/PageHeader";
import type { AccountSummary, GameProfileView, GameView, PlatformView } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { AccountLogo, CatalogLogo } from "./CatalogLogo";
import { CatalogDialog, platformKindLabel, type CatalogKind } from "./CatalogDialog";

type Entry = GameView | PlatformView;

const COPY = {
  game: {
    title: "Games",
    noun: "game",
    icon: GameControllerIcon,
    emptyTitle: "No games yet",
    emptyDescription:
      "Pick a game on an account, or add a game profile to one, and it shows up here with every account and profile for it.",
  },
  platform: {
    title: "Platforms",
    noun: "platform",
    icon: AppWindowIcon,
    emptyTitle: "No platforms yet",
    emptyDescription:
      "Pick a platform such as Steam, Battle.net or Riot on an account, and it shows up here with every account on it.",
  },
} as const;

function subtitle(entry: Entry) {
  const what = "kind" in entry ? platformKindLabel(entry.kind) : "franchise" in entry ? entry.franchise : null;
  return [what, entry.publisher].filter(Boolean).join(" · ");
}

function counts(entry: Entry) {
  const parts = [
    entry.accountCount > 0 && `${String(entry.accountCount)} ${entry.accountCount === 1 ? "account" : "accounts"}`,
    entry.profileCount > 0 && `${String(entry.profileCount)} ${entry.profileCount === 1 ? "profile" : "profiles"}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function AccountLine({ account }: { account: AccountSummary }) {
  return (
    <li>
      <Link
        to="/accounts/$accountId"
        params={{ accountId: account.id }}
        className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <AccountLogo account={account} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{account.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[account.username ?? account.email, account.identityName].filter(Boolean).join(" · ")}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ProfileLine({ kind, profile }: { kind: CatalogKind; profile: GameProfileView }) {
  const meta = [
    kind === "platform" ? profile.gameName : profile.platformName,
    profile.rankTier,
    profile.region,
    `on ${profile.accountTitle}`,
  ].filter(Boolean);
  return (
    <li>
      <Link
        to="/accounts/$accountId"
        params={{ accountId: profile.accountId }}
        className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CatalogLogo icon={profile.gameIcon} name={profile.gameName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {profile.gamertag ?? profile.gameName}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{meta.join(" · ")}</span>
        </span>
      </Link>
    </li>
  );
}

/** One game or platform in use, with its accounts and game profiles under it. */
function EntryCard({
  kind,
  entry,
  accounts,
  profiles,
  onEdit,
}: {
  kind: CatalogKind;
  entry: Entry;
  accounts: AccountSummary[];
  profiles: GameProfileView[];
  onEdit: () => void;
}) {
  const headingId = `entry-${entry.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <CatalogLogo icon={entry.icon} name={entry.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-[15px] font-semibold">
            {entry.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {[subtitle(entry), counts(entry)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${entry.name}`} onClick={onEdit}>
          <PencilSimpleIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-x-6 gap-y-3 px-2 py-2 md:grid-cols-2">
        {accounts.length > 0 && (
          <div>
            <h3 className="px-2 pt-1 pb-1 text-xs font-medium text-subtle-foreground">Accounts</h3>
            <ul>
              {accounts.map((a) => (
                <AccountLine key={a.id} account={a} />
              ))}
            </ul>
          </div>
        )}
        {profiles.length > 0 && (
          <div>
            <h3 className="px-2 pt-1 pb-1 text-xs font-medium text-subtle-foreground">Game profiles</h3>
            <ul>
              {profiles.map((p) => (
                <ProfileLine key={p.id} kind={kind} profile={p} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The Games or Platforms page: entries in use, each with the accounts and
 * game profiles grouped under it, then the rest of the catalog to browse
 * and edit. Archived accounts are left out.
 */
export function CatalogPage({ kind }: { kind: CatalogKind }) {
  const copy = COPY[kind];
  const games = useGames();
  const platforms = usePlatforms();
  const entries = kind === "game" ? games : platforms;
  const accounts = useAccounts(false);
  const profiles = useGameProfiles({
    accountId: null,
    gameId: null,
    platformId: null,
  });
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const all: Entry[] = entries.data ?? [];
  const inUse = all.filter((e) => e.accountCount + e.profileCount > 0);
  const rest = all.filter((e) => e.accountCount + e.profileCount === 0);
  const accountsOf = (id: string) =>
    (accounts.data ?? []).filter((a) => (kind === "game" ? a.gameId : a.platformId) === id);
  const profilesOf = (id: string) =>
    (profiles.data ?? []).filter((p) => (kind === "game" ? p.gameId : p.platformId) === id);

  return (
    <>
      <PageHeader
        title={copy.title}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditing("new");
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add {copy.noun}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {entries.isPending ? null : entries.isError ? (
          <EmptyState
            icon={copy.icon}
            title={`Couldn't load ${copy.title.toLowerCase()}`}
            description="Lock and unlock the vault, then try again."
          />
        ) : (
          <div className="flex max-w-5xl flex-col gap-4">
            {inUse.length === 0 ? (
              <EmptyState icon={copy.icon} title={copy.emptyTitle} description={copy.emptyDescription} />
            ) : (
              inUse.map((e) => (
                <EntryCard
                  key={e.id}
                  kind={kind}
                  entry={e}
                  accounts={accountsOf(e.id)}
                  profiles={profilesOf(e.id)}
                  onEdit={() => {
                    setEditing(e);
                  }}
                />
              ))
            )}
            {rest.length > 0 && (
              <section aria-labelledby="catalog-rest" className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  aria-expanded={showCatalog}
                  aria-controls="catalog-rest-list"
                  className="flex items-center gap-1.5 self-start rounded-sm text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setShowCatalog((v) => !v);
                  }}
                >
                  <CaretDownIcon
                    aria-hidden="true"
                    className={cn("size-3.5 transition-transform", !showCatalog && "-rotate-90")}
                  />
                  <span id="catalog-rest">
                    {inUse.length === 0 ? "All" : "More"} {copy.title.toLowerCase()} in the catalog ({rest.length})
                  </span>
                </button>
                {showCatalog && (
                  <ul
                    id="catalog-rest-list"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-2 md:grid-cols-3"
                  >
                    {rest.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => {
                            setEditing(e);
                          }}
                        >
                          <CatalogLogo icon={e.icon} name={e.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-foreground">{e.name}</span>
                            <span className="block truncate text-xs text-subtle-foreground">
                              {e.isBuiltin ? subtitle(e) || "Built-in" : "Added by you"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
      {editing && (
        <CatalogDialog
          kind={kind}
          entry={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
    </>
  );
}
