import { Link } from "@tanstack/react-router";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "@/app/nav";
import { KeyboardHint } from "@/components/common/KeyboardHint";
import { BrandMark } from "./BrandMark";

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      activeOptions={{ exact: true }}
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
          <div key={group.label ?? i} role="group" aria-label={group.label ?? "Overview"}>
            {group.label && (
              <div className="px-2.5 pb-1 text-xs font-medium text-subtle-foreground">{group.label}</div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.path} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-2">
        <NavLink item={SETTINGS_ITEM} />
      </div>
    </aside>
  );
}
