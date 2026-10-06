import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PurposeBadge } from "@/components/common/PurposeBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import { cn } from "@/lib/utils";
import { FavoriteStar, QuickCopy, Security, SelectBox } from "./AccountBits";
import { padding, useRows, type AccountListProps } from "./AccountTable";
import { displayStatus } from "./labels";

const CARD_MIN_WIDTH = 260;
const GAP = 12;
const ROW_HEIGHT = 156 + GAP;

/** How many cards fit across the scroll area. */
function useColumns(scrollRef: AccountListProps["scrollRef"]) {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      // The scroll area's padding (24 px each side) isn't card space.
      const width = el.clientWidth - 48;
      setColumns(Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [scrollRef]);
  return columns;
}

/** The card layout: a grid, rendered a row of cards at a time. */
export function AccountCards({ rows, scrollRef, selection, identityColor, label }: AccountListProps) {
  const navigate = useNavigate();
  const columns = useColumns(scrollRef);
  const v = useRows(Math.ceil(rows.length / columns), scrollRef, ROW_HEIGHT);
  const { items, top, bottom } = padding(v);

  return (
    <div role="list" aria-label={label} style={{ paddingTop: top, paddingBottom: bottom }}>
      {items.map((item) => (
        <div
          key={item.index}
          role="presentation"
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
            gap: GAP,
            height: ROW_HEIGHT,
            paddingBottom: GAP,
          }}
        >
          {rows.slice(item.index * columns, item.index * columns + columns).map((account) => {
            const status = displayStatus(account);
            const checked = selection.selected.has(account.id);
            return (
              <div
                key={account.id}
                role="listitem"
                className={cn(
                  "flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-border-strong hover:bg-muted/40",
                  checked && "border-brand/50 bg-brand/8",
                )}
                onClick={() => {
                  void navigate({ to: "/accounts/$accountId", params: { accountId: account.id } });
                }}
              >
                <div className="flex items-start gap-3">
                  <AccountLogo account={account} />
                  <div className="min-w-0 flex-1">
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
                    <p className="truncate text-xs text-muted-foreground">
                      {account.username ?? account.email ?? account.purposeName}
                    </p>
                  </div>
                  <SelectBox
                    label={`Select ${account.title}`}
                    checked={checked}
                    onToggle={(shift) => {
                      selection.toggle(account.id, shift);
                    }}
                  />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  {account.identityName ? (
                    <IdentityChip name={account.identityName} color={identityColor(account.identityId)} />
                  ) : (
                    <span className="text-subtle-foreground">No identity</span>
                  )}
                  <span aria-hidden="true" className="text-subtle-foreground">
                    ·
                  </span>
                  <PurposeBadge purposeId={account.purposeId} name={account.purposeName} />
                </div>
                <div className="mt-auto flex items-end justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <StatusBadge status={status.badge} label={status.label} className="self-start" />
                    <Security account={account} />
                  </div>
                  <QuickCopy account={account} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
