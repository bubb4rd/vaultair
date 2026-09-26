import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ALL_NAV_ITEMS, PAGE_PATHS } from "@/app/nav";
import { useSavedViews } from "@/app/queries";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { ARCHIVED_VIEW_ID, openView as showView } from "@/features/accounts/listState";
import { ViewGlyph } from "@/features/accounts/SavedViews";
import { IdentityAvatar } from "@/features/identities/IdentityAvatar";
import { search, type SavedView, type SearchHit } from "@/ipc/client";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Typing waits this long before searching the vault. */
const SEARCH_DELAY_MS = 120;

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      window.clearTimeout(t);
    };
  }, [value, ms]);
  return settled;
}

const matches = (q: string, ...words: (string | undefined)[]) =>
  words.some((w) => w?.toLowerCase().includes(q.toLowerCase()));

function hitKey(hit: SearchHit) {
  return hit.kind === "account" ? `account:${hit.account.id}` : `${hit.kind}:${hit.id}`;
}

/** One vault result: what it is, and the detail that tells it apart. */
function HitRow({ hit }: { hit: SearchHit }) {
  const archived = hit.kind === "identity" ? hit.archived : hit.account.archivedAt !== null;
  const [icon, title, detail] =
    hit.kind === "account"
      ? [
          <AccountLogo key="logo" account={hit.account} />,
          hit.account.title,
          hit.account.username ?? hit.account.email ?? hit.account.purposeName,
        ]
      : hit.kind === "gameProfile"
        ? [
            <AccountLogo key="logo" account={hit.account} />,
            hit.gamertag ?? hit.gameName,
            `${hit.gameName} profile on ${hit.account.title}`,
          ]
        : [
            <IdentityAvatar key="avatar" name={hit.name} color={hit.color} size="sm" />,
            hit.name,
            hit.primaryEmail ?? "Identity",
          ];
  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {detail}
          {archived && " · Archived"}
        </span>
      </span>
    </>
  );
}

/**
 * Ctrl+K: search the vault (accounts, game profiles by gamertag, and
 * identities), open a saved view, or go to a page. Vault search runs in
 * Rust against an index that holds no secrets.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = query.trim();
  const settled = useDebounced(q, SEARCH_DELAY_MS);
  const views = useSavedViews().data ?? [];
  const hits = useQuery({
    queryKey: ["search", settled],
    queryFn: () => search.query(settled, 20),
    enabled: open && settled.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
  const vaultHits = settled ? (hits.data ?? []) : [];
  const pages = ALL_NAV_ITEMS.filter((item) => !q || matches(q, item.label, ...(item.keywords ?? [])));
  const shownViews = views.filter((v) => v.id !== ARCHIVED_VIEW_ID && (!q || matches(q, v.name)));

  function change(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function go(to: () => void) {
    change(false);
    to();
  }

  function openHit(hit: SearchHit) {
    go(() => {
      if (hit.kind === "identity") {
        void navigate({ to: "/identities/$identityId", params: { identityId: hit.id } });
      } else {
        void navigate({ to: "/accounts/$accountId", params: { accountId: hit.account.id } });
      }
    });
  }

  function openView(view: SavedView) {
    go(() => {
      showView("accounts", view);
      void navigate({ to: PAGE_PATHS.accounts });
    });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={change}
      title="Search"
      description="Search the vault, open a view, or jump to a page"
      shouldFilter={false}
    >
      <CommandInput placeholder="Search accounts, gamertags, identities" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{hits.isFetching ? "Searching…" : "Nothing matches."}</CommandEmpty>
        {vaultHits.length > 0 && (
          <CommandGroup heading="In your vault">
            {vaultHits.map((hit) => (
              <CommandItem
                key={hitKey(hit)}
                value={hitKey(hit)}
                className="gap-3 py-2"
                onSelect={() => {
                  openHit(hit);
                }}
              >
                <HitRow hit={hit} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shownViews.length > 0 && (
          <CommandGroup heading="Views">
            {shownViews.map((view) => (
              <CommandItem
                key={view.id}
                value={`view:${view.id}`}
                onSelect={() => {
                  openView(view);
                }}
              >
                <ViewGlyph view={view} />
                {view.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {pages.length > 0 && (
          <CommandGroup heading="Go to">
            {pages.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.path}
                  value={`page:${item.path}`}
                  onSelect={() => {
                    go(() => void navigate({ to: item.path }));
                  }}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
