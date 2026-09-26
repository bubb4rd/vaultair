import { Link, useNavigate } from "@tanstack/react-router";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import { cn } from "@/lib/utils";
import { FavoriteStar, QuickCopy, SelectBox } from "./AccountBits";
import { padding, useRows, type AccountListProps } from "./AccountTable";
import { displayStatus } from "./labels";

const ROW_HEIGHT = 37;

/** The compact layout: one dense line per account, for scanning long lists. */
export function AccountCompact({ rows, scrollRef, selection, label }: AccountListProps) {
  const navigate = useNavigate();
  const v = useRows(rows.length, scrollRef, ROW_HEIGHT);
  const { items, top, bottom } = padding(v);

  return (
    <div
      role="list"
      aria-label={label}
      className="rounded-lg border border-border bg-card"
      style={{ paddingTop: top, paddingBottom: bottom }}
    >
      {items.map((item) => {
        const account = rows[item.index];
        if (!account) return null;
        const status = displayStatus(account);
        const checked = selection.selected.has(account.id);
        return (
          <div
            key={account.id}
            role="listitem"
            style={{ height: ROW_HEIGHT }}
            className={cn(
              "flex cursor-pointer items-center gap-3 border-t border-border pr-2 pl-4 transition-colors first:border-t-0 hover:bg-muted/60",
              checked && "bg-brand/8 hover:bg-brand/12",
            )}
            onClick={() => {
              void navigate({ to: "/accounts/$accountId", params: { accountId: account.id } });
            }}
          >
            <SelectBox
              label={`Select ${account.title}`}
              checked={checked}
              onToggle={(shift) => {
                selection.toggle(account.id, shift);
              }}
            />
            <AccountLogo account={account} size="xs" />
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
              <span className="truncate text-xs text-muted-foreground">{account.username ?? account.email}</span>
            </div>
            <span className="hidden w-28 truncate text-xs text-muted-foreground lg:block">
              {account.identityName ?? ""}
            </span>
            <span className="hidden w-24 truncate text-xs text-muted-foreground md:block">{account.purposeName}</span>
            <StatusBadge status={status.badge} label={status.label} className="shrink-0" />
            <QuickCopy account={account} />
          </div>
        );
      })}
    </div>
  );
}
