import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { LockSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "@/app/nav";
import { useAccounts, useOpenVault } from "@/app/queries";
import { KeyboardHint } from "@/components/common/KeyboardHint";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { lockVault } from "@/features/lock/lockVault";
import { BrandMark } from "./BrandMark";
import { FavoritesGroup } from "./FavoritesGroup";

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      // "All Accounts" stays highlighted on an account's own pages.
      activeOptions={{ exact: item.path === "/" }}
      className="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:text-foreground"
    >
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-subtle-foreground group-hover:text-muted-foreground group-data-[status=active]:text-brand"
        weight="regular"
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <div className="px-2.5 pb-1 text-xs font-medium text-subtle-foreground">{children}</div>;
}

function VaultRow() {
  const openVault = useOpenVault();
  return (
    <div className="flex items-center gap-2 pt-1 pl-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground" title={openVault?.path}>
          {openVault?.name ?? "Vault"}
        </p>
        {openVault?.demo && <p className="text-xs text-subtle-foreground">Demo vault</p>}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Lock vault"
            aria-keyshortcuts="Control+L"
            onClick={lockVault}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <LockSimpleIcon aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          Lock <KeyboardHint keys={["Ctrl", "L"]} />
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Starred accounts, in the order they were starred (ADR-0004 decision 20). */
function Favorites() {
  const list = useAccounts(false);
  const items = (list.data ?? [])
    .filter((a) => a.favorite)
    .sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""))
    .map((a) => ({ id: a.id, label: a.title, detail: a.purposeName }));
  return <FavoritesGroup items={items} />;
}

export function Sidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <aside className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Brand row: part of the window drag region. */}
      <div data-tauri-drag-region className="flex h-[var(--header-height)] shrink-0 items-center gap-2.5 px-4">
        <BrandMark className="pointer-events-none size-5" />
        <span data-tauri-drag-region className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          Vaultair
        </span>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border-strong bg-background/40 px-2.5 text-[13px] text-subtle-foreground transition-colors hover:border-input hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <MagnifyingGlassIcon aria-hidden="true" className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <KeyboardHint keys={["Ctrl", "K"]} />
        </button>
      </div>

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group, i) => (
          <Fragment key={group.label ?? i}>
            <div role="group" aria-label={group.label ?? "Overview"}>
              {group.label && <GroupLabel>{group.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.path} item={item} />
                ))}
              </div>
            </div>
            {group.label === "Vault" && <Favorites />}
          </Fragment>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
        <NavLink item={SETTINGS_ITEM} />
        <VaultRow />
      </div>
    </aside>
  );
}
