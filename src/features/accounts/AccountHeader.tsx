import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { GameControllerIcon, IdentificationBadgeIcon, StarIcon, TagIcon } from "@phosphor-icons/react";
import { usePurposes } from "@/app/queries";
import { PurposeDot } from "@/components/common/PurposeBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountLogo } from "@/features/catalog/CatalogLogo";
import type { AccountDetail } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { accountType, displayStatus } from "./labels";

const CHIP = "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium";

/** A neutral fact chip, the same size as a status badge. */
function Chip({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn(CHIP, className)}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function PurposeChip({ account }: { account: AccountDetail }) {
  const color = usePurposes().data?.find((p) => p.id === account.purposeId)?.color ?? null;
  return (
    <span className={cn(CHIP, "max-w-[200px]")} data-purpose-color={color ?? "none"}>
      <PurposeDot color={color} />
      <span className="truncate">{account.purposeName}</span>
    </span>
  );
}

/**
 * The top of the account page: who the account is, at a glance. The window
 * header already carries the title as the page heading, so this one is text.
 */
export function AccountHeader({
  account,
  onFavorite,
  actions,
}: {
  account: AccountDetail;
  onFavorite: () => void;
  actions: ReactNode;
}) {
  const type = accountType(account.accountType);
  const status = displayStatus(account);
  const subtitle = [account.platformName ?? account.gameName ?? account.publisher, type.label]
    .filter(Boolean)
    .join(" · ");
  const favoriteLabel = account.favorite ? "Remove from favorites" : "Add to favorites";

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-border pb-6">
      <AccountLogo account={account} size="lg" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <p className="min-w-0 text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words">
              {account.title}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={account.favorite}
                  aria-label={favoriteLabel}
                  onClick={onFavorite}
                >
                  <StarIcon
                    aria-hidden="true"
                    weight={account.favorite ? "fill" : "regular"}
                    className={account.favorite ? "text-status-attention" : undefined}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{favoriteLabel}</TooltipContent>
            </Tooltip>
          </div>
          {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        <ul aria-label="At a glance" className="flex flex-wrap items-center gap-1.5">
          <li>
            <StatusBadge status={status.badge} label={status.label} />
          </li>
          <li className="min-w-0">
            <PurposeChip account={account} />
          </li>
          {account.gameName && (
            <li className="min-w-0">
              <Chip
                icon={<GameControllerIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                className="max-w-[240px]"
              >
                {account.gameName}
              </Chip>
            </li>
          )}
          {account.identityId && account.identityName && (
            <li className="min-w-0">
              <Link
                to="/identities/$identityId"
                params={{ identityId: account.identityId }}
                className={cn(
                  CHIP,
                  "max-w-[240px] transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                )}
              >
                <IdentificationBadgeIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{account.identityName}</span>
              </Link>
            </li>
          )}
          {account.tags.map((tag) => (
            <li key={tag} className="min-w-0">
              <Chip
                icon={<TagIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
                className="max-w-[200px]"
              >
                {tag}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}
