import { Link } from "@tanstack/react-router";
import { StarIcon } from "@phosphor-icons/react";

/** A starred account as the sidebar shows it. */
export interface FavoriteAccount {
  id: string;
  label: string;
  /** Short context, e.g. the purpose ("Main"). */
  detail?: string;
}

/**
 * The sidebar's Favorites section: the accounts the user has starred, in the
 * order they starred them. It replaces a separate Favorites page. Each row
 * opens the account; with none starred it explains how to add one.
 */
export function FavoritesGroup({ items = [] }: { items?: FavoriteAccount[] }) {
  return (
    <div role="group" aria-label="Favorites">
      <div className="px-2.5 pb-1 text-xs font-medium text-subtle-foreground">Favorites</div>
      {items.length === 0 ? (
        <p
          title="Star an account to pin it here"
          className="flex items-center gap-2.5 px-2.5 py-1 text-[13px] whitespace-nowrap text-subtle-foreground"
        >
          <StarIcon aria-hidden="true" className="size-4 shrink-0" />
          No starred accounts yet
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((account) => (
            <li key={account.id}>
              <Link
                to="/accounts/$accountId"
                params={{ accountId: account.id }}
                className="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
              >
                <StarIcon aria-hidden="true" weight="fill" className="size-4 shrink-0 text-status-attention" />
                <span className="truncate">{account.label}</span>
                {account.detail && (
                  <span className="ml-auto shrink-0 truncate text-xs text-subtle-foreground">{account.detail}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
