import type { RefObject } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PurposeBadge } from "@/components/common/PurposeBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import type { AccountSort, AccountSummary, SortKey } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { FavoriteStar, QuickCopy, Security, SelectBox, type IdentityColorOf } from "./AccountBits";
import { displayStatus } from "./labels";
import type { Selection } from "./useSelection";

/** What every layout of the list takes. */
export interface AccountListProps {
  rows: AccountSummary[];
  /** The element that scrolls; rows outside it aren't rendered. */
  scrollRef: RefObject<HTMLDivElement | null>;
  selection: Selection;
  identityColor: IdentityColorOf;
  /** Names the list for screen readers ("All Accounts", a view's name). */
  label: string;
}

/**
 * Rows outside the scroll area aren't rendered, so the list stays fast at
 * thousands of accounts. `initialRect` allows a first render before the
 * scroll area has been measured.
 */
export function useRows(count: number, scrollRef: RefObject<HTMLDivElement | null>, rowHeight: number) {
  return useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 1024, height: 720 },
  });
}

/** The rendered rows, and the space above and below them. */
export function padding(v: ReturnType<typeof useRows>) {
  const items = v.getVirtualItems();
  const top = items[0]?.start ?? 0;
  const bottom = v.getTotalSize() - (items.at(-1)?.end ?? 0);
  return { items, top, bottom };
}

const TH = "sticky top-0 z-10 bg-card py-2 pr-4 font-medium";

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: AccountSort;
  onSort: (sort: AccountSort) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Arrow = sort.descending ? ArrowDownIcon : ArrowUpIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      className={cn(TH, className)}
    >
      <button
        type="button"
        className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          onSort({ key: column, descending: active ? !sort.descending : false });
        }}
      >
        {label}
        {active && <Arrow aria-hidden="true" className="size-3" weight="bold" />}
      </button>
    </th>
  );
}

export const TABLE_ROW_HEIGHT = 57;

/** The table layout: sortable columns, a checkbox per row, quick copy. */
export function AccountTable({
  rows,
  scrollRef,
  selection,
  identityColor,
  label,
  sort,
  onSort,
}: AccountListProps & { sort: AccountSort; onSort: (sort: AccountSort) => void }) {
  const navigate = useNavigate();
  const v = useRows(rows.length, scrollRef, TABLE_ROW_HEIGHT);
  const { items, top, bottom } = padding(v);

  return (
    <div className="rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-left" aria-rowcount={rows.length + 1}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-xs text-subtle-foreground" aria-rowindex={1}>
            <th scope="col" className={cn(TH, "w-10 rounded-tl-lg pr-0 pl-4")}>
              <SelectBox
                label="Select all"
                checked={selection.all}
                indeterminate={selection.some}
                onToggle={selection.toggleAll}
              />
            </th>
            <SortHeader label="Account" column="title" sort={sort} onSort={onSort} className="pl-2" />
            <SortHeader label="Identity" column="identity" sort={sort} onSort={onSort} />
            <SortHeader label="Purpose" column="purpose" sort={sort} onSort={onSort} />
            <SortHeader label="Status" column="activity" sort={sort} onSort={onSort} />
            <th scope="col" className={TH}>
              Security
            </th>
            <th scope="col" className={cn(TH, "rounded-tr-lg pr-3")}>
              <span className="sr-only">Quick copy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {top > 0 && (
            <tr aria-hidden="true">
              <td colSpan={7} style={{ height: top }} />
            </tr>
          )}
          {items.map((item) => {
            const account = rows[item.index];
            if (!account) return null;
            const status = displayStatus(account);
            const secondary = account.username ?? account.email;
            const checked = selection.selected.has(account.id);
            return (
              <tr
                key={account.id}
                aria-rowindex={item.index + 2}
                aria-selected={checked}
                style={{ height: TABLE_ROW_HEIGHT }}
                className={cn(
                  "group cursor-pointer border-t border-border transition-colors hover:bg-muted/60",
                  checked && "bg-brand/8 hover:bg-brand/12",
                )}
                onClick={() => {
                  void navigate({ to: "/accounts/$accountId", params: { accountId: account.id } });
                }}
              >
                <td className="w-10 pr-0 pl-4">
                  <SelectBox
                    label={`Select ${account.title}`}
                    checked={checked}
                    onToggle={(shift) => {
                      selection.toggle(account.id, shift);
                    }}
                  />
                </td>
                <td className="py-2 pr-4 pl-2">
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
                        <FavoriteStar account={account} />
                      </div>
                      {secondary && <p className="truncate text-xs text-muted-foreground">{secondary}</p>}
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-4 text-[13px] text-muted-foreground">
                  {account.identityName ? (
                    <IdentityChip name={account.identityName} color={identityColor(account.identityId)} />
                  ) : (
                    <span className="text-subtle-foreground">None</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-[13px] text-muted-foreground">
                  <PurposeBadge purposeId={account.purposeId} name={account.purposeName} />
                </td>
                <td className="py-2 pr-4">
                  <div className="flex flex-col items-start gap-0.5">
                    <StatusBadge status={status.badge} label={status.label} />
                    <span className="text-xs whitespace-nowrap text-subtle-foreground">{status.activity}</span>
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <Security account={account} />
                </td>
                <td className="py-2 pr-3">
                  <QuickCopy account={account} />
                </td>
              </tr>
            );
          })}
          {bottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={7} style={{ height: bottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
