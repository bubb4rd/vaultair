import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Icon } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RowsIcon,
  SortAscendingIcon,
  SquaresFourIcon,
  TableIcon,
} from "@phosphor-icons/react";
import {
  useAccountList,
  useAccounts,
  useGames,
  useIdentityRefs,
  useOpenVault,
  usePlatforms,
  usePurposes,
  useSavedViews,
  useTags,
} from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/features/shell/PageHeader";
import {
  DEFAULT_SORT,
  EMPTY_FILTER,
  type AccountFilter,
  type AccountSort,
  type AccountSummary,
  type SavedView,
  type SortKey,
} from "@/ipc/client";
import { cn } from "@/lib/utils";
import { DemoNotice } from "./AccountBits";
import { AccountCards } from "./AccountCards";
import { AccountCompact } from "./AccountCompact";
import { AccountTable } from "./AccountTable";
import { BulkActionBar } from "./BulkActionBar";
import { FilterChips } from "./FilterChips";
import { SORT_OPTIONS, sameSpec, type FilterContext } from "./filters";
import { openView, setListState, useListState, type ListKey, type ListLayout } from "./listState";
import { ViewMenu } from "./SavedViews";
import { useSelection } from "./useSelection";

/** Typing waits this long before the list asks Rust again. */
const SEARCH_DELAY_MS = 150;

const LAYOUTS: { value: ListLayout; label: string; icon: Icon }[] = [
  { value: "table", label: "Table", icon: TableIcon },
  { value: "cards", label: "Cards", icon: SquaresFourIcon },
  { value: "compact", label: "Compact", icon: RowsIcon },
];

function LayoutToggle({ value, onChange }: { value: ListLayout; onChange: (layout: ListLayout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="flex h-7 items-center rounded-md border border-border-strong p-0.5">
      {LAYOUTS.map((l) => {
        const LayoutIcon = l.icon;
        const on = l.value === value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={l.label}
            title={l.label}
            className={cn(
              "grid h-full w-7 cursor-pointer place-items-center rounded-sm text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              on && "bg-muted text-foreground",
            )}
            onClick={() => {
              onChange(l.value);
            }}
          >
            <LayoutIcon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

function SortMenu({ sort, onChange }: { sort: AccountSort; onChange: (sort: AccountSort) => void }) {
  const label = SORT_OPTIONS.find((o) => o.key === sort.key)?.label ?? "Name";
  const Arrow = sort.descending ? ArrowDownIcon : ArrowUpIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7" aria-label={`Sort by ${label}`}>
          <SortAscendingIcon aria-hidden="true" />
          {label}
          <Arrow aria-hidden="true" className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs text-subtle-foreground">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort.key}
          onValueChange={(key) => {
            onChange({ ...sort, key: key as SortKey });
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key} className="text-[13px]">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={sort.descending ? "desc" : "asc"}
          onValueChange={(dir) => {
            onChange({ ...sort, descending: dir === "desc" });
          }}
        >
          <DropdownMenuRadioItem value="asc" className="text-[13px]">
            Ascending
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc" className="text-[13px]">
            Descending
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The list's text search. Keeps its own text while typing and hands it on
 * once typing pauses. Re-keyed when a view replaces the filter.
 */
function SearchBox({
  label,
  initial,
  onSettle,
}: {
  label: string;
  initial: string;
  onSettle: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const settle = useRef(onSettle);
  useEffect(() => {
    settle.current = onSettle;
  });
  useEffect(() => {
    const t = window.setTimeout(() => {
      settle.current(text.trim() || null);
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [text]);
  return (
    <div className="relative w-full max-w-xs">
      <MagnifyingGlassIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder="Name, gamertag, email, tag or notes"
        value={text}
        autoComplete="off"
        spellCheck={false}
        className="h-7 pl-9 text-[13px]"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
    </div>
  );
}

/** What the filter menus offer: only what the vault has. */
function useFilterContext(all: AccountSummary[]): FilterContext {
  const identities = useIdentityRefs().data;
  const purposes = usePurposes().data;
  const platforms = usePlatforms().data;
  const games = useGames().data;
  const tags = useTags().data;
  return useMemo(() => {
    const publishers = new Map<string, string>();
    for (const a of all) {
      const p = a.publisher?.trim();
      if (p && !publishers.has(p.toLowerCase())) publishers.set(p.toLowerCase(), p);
    }
    const usedPlatforms = new Set(all.map((a) => a.platformId));
    return {
      identities: identities ?? [],
      purposes: purposes ?? [],
      platforms: (platforms ?? []).filter((p) => usedPlatforms.has(p.id)),
      games: (games ?? []).filter((g) => g.accountCount > 0 || g.profileCount > 0),
      tags: tags ?? [],
      publishers: [...publishers.values()].sort((a, b) => a.localeCompare(b)),
    };
  }, [all, identities, purposes, platforms, games, tags]);
}

/**
 * All Accounts (optionally through a saved view), or the Archived list,
 * which is the built-in Archived view. Text, filters and sort all run in
 * Rust against the search index; the list only renders the rows on screen.
 */
export function AccountsPage({ archived = false }: { archived?: boolean }) {
  const key: ListKey = archived ? "archived" : "accounts";
  const state = useListState(key);
  const views = useSavedViews().data ?? [];
  const current = state.viewId ? (views.find((v) => v.id === state.viewId) ?? null) : null;
  const filter: AccountFilter = { ...state.filter, archived };

  const all = useAccounts(archived);
  const list = useAccountList(filter, state.sort);
  const vault = useOpenVault();
  const refs = useIdentityRefs();
  const identityColor = (id: string | null) => refs.data?.find((r) => r.id === id)?.color ?? null;
  const ctx = useFilterContext(all.data ?? []);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const ids = useMemo(() => rows.map((a) => a.id), [rows]);
  const selection = useSelection(ids);
  const selected = rows.filter((a) => selection.selected.has(a.id));
  const scrollRef = useRef<HTMLDivElement>(null);

  const total = all.data?.length ?? 0;
  const title = archived ? "Archived" : (current?.name ?? "All Accounts");
  const baseline = current?.spec ?? { v: 1, filter: { ...EMPTY_FILTER, archived }, sort: DEFAULT_SORT };
  const edited = !sameSpec({ filter, sort: state.sort }, baseline);

  const update = (next: Partial<{ filter: AccountFilter; sort: AccountSort; layout: ListLayout }>) => {
    setListState(key, next);
  };
  const showView = (view: SavedView | null) => {
    openView(key, view);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const newButton = !archived && (
    <Button asChild size="sm">
      <Link to="/accounts/new">
        <PlusIcon aria-hidden="true" />
        New account
      </Link>
    </Button>
  );

  if (all.isPending) return <PageHeader title={title} actions={newButton} />;

  if (all.isError || list.isError || total === 0) {
    return (
      <>
        <PageHeader title={title} actions={newButton} />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
          {all.isError || list.isError ? (
            <EmptyState icon={KeyIcon} title="Couldn't load accounts" description="Lock and unlock the vault, then try again." />
          ) : archived ? (
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
          )}
        </div>
      </>
    );
  }

  const listProps = { rows, scrollRef, selection, identityColor, label: title };
  const count =
    rows.length === total
      ? `${String(total)} ${total === 1 ? "account" : "accounts"}`
      : `${String(rows.length)} of ${String(total)}`;

  return (
    <>
      <PageHeader title={title} actions={newButton} />
      <div className="flex max-w-6xl shrink-0 flex-col gap-3 px-6 pt-5 pb-3">
        {vault?.demo && !archived && <DemoNotice />}
        <div className="flex flex-wrap items-center gap-2">
          {!archived && (
            <ViewMenu
              views={views}
              current={current}
              spec={{ v: 1, filter, sort: state.sort }}
              edited={edited}
              onOpen={showView}
              onSaved={(view) => {
                setListState(key, { viewId: view.id });
              }}
            />
          )}
          <SearchBox
            key={state.revision}
            label={archived ? "Search archived accounts" : "Search accounts"}
            initial={state.filter.text ?? ""}
            onSettle={(text) => {
              if (text !== (state.filter.text ?? null)) update({ filter: { ...state.filter, text } });
            }}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <SortMenu
              sort={state.sort}
              onChange={(sort) => {
                update({ sort });
              }}
            />
            <LayoutToggle
              value={state.layout}
              onChange={(layout) => {
                update({ layout });
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            filter={filter}
            ctx={ctx}
            onChange={(f) => {
              update({ filter: f });
            }}
          />
          <p className="ml-1 text-xs text-subtle-foreground" aria-live="polite">
            {list.isPending ? "" : count}
          </p>
        </div>
      </div>

      <div ref={scrollRef} data-list-scroll className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="max-w-6xl">
          {list.isPending ? null : rows.length === 0 ? (
            <p className="py-8 text-[13px] text-muted-foreground">
              {filter.text ? `No accounts match “${filter.text}”.` : "No accounts match these filters."}
            </p>
          ) : state.layout === "cards" ? (
            <AccountCards {...listProps} />
          ) : state.layout === "compact" ? (
            <AccountCompact {...listProps} />
          ) : (
            <AccountTable
              {...listProps}
              sort={state.sort}
              onSort={(sort) => {
                update({ sort });
              }}
            />
          )}
        </div>
      </div>

      {selected.length > 0 && <BulkActionBar selected={selected} archived={archived} onClear={selection.clear} />}
    </>
  );
}
