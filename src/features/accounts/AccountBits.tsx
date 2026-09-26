import { useEffect, useRef } from "react";
import { FlaskIcon, PasswordIcon, ShieldCheckIcon, ShieldSlashIcon, StarIcon, UserIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copySecret, copyToClipboard } from "@/features/clipboard/copy";
import type { AccountSummary, IdentityColor } from "@/ipc/client";
import { passwordStrength } from "./labels";

/** Looks up an identity's colour for its chip. */
export type IdentityColorOf = (id: string | null) => IdentityColor | null;

/** Password strength and MFA at a glance: icon and text, never colour alone. */
export function Security({ account }: { account: AccountSummary }) {
  const strength = account.passwordStrength === null ? null : passwordStrength(account.passwordStrength);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {strength && strength.status !== "secure" && <StatusBadge status={strength.status} label={`${strength.label} password`} />}
      {!account.hasPassword && <StatusBadge status="unknown" label="No password" />}
      {account.mfaEnabled ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="size-3.5 text-status-secure" weight="bold" />
          MFA
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldSlashIcon aria-hidden="true" className="size-3.5 text-status-warning" weight="bold" />
          No MFA
        </span>
      )}
    </div>
  );
}

export function FavoriteStar({ account }: { account: AccountSummary }) {
  return account.favorite ? (
    <StarIcon aria-label="Favorite" weight="fill" className="size-3.5 shrink-0 text-status-attention" />
  ) : null;
}

/** An icon button in a row; it doesn't open the account. */
function RowAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Copy the username (or the email, without one) and the password without
 * opening the account. Both go through Rust and clear from the clipboard;
 * the password is never sent to the page. Copying the password counts as
 * activity, so the row's status is refreshed.
 */
export function QuickCopy({ account }: { account: AccountSummary }) {
  const queryClient = useQueryClient();
  const login = account.username ?? account.email;
  const loginLabel = account.username ? "username" : "email";
  const gap = <span aria-hidden="true" className="size-7" />;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {login ? (
        <RowAction
          label={`Copy ${loginLabel} for ${account.title}`}
          tip={`Copy ${loginLabel}`}
          onClick={() => void copyToClipboard(login, account.username ? "Username" : "Email")}
        >
          <UserIcon aria-hidden="true" />
        </RowAction>
      ) : (
        gap
      )}
      {account.hasPassword ? (
        <RowAction
          label={`Copy password for ${account.title}`}
          tip="Copy password"
          onClick={() => {
            void copySecret({ kind: "accountPassword", id: account.id }, "Password").then((copied) => {
              if (copied) void queryClient.invalidateQueries({ queryKey: ["accounts"] });
            });
          }}
        >
          <PasswordIcon aria-hidden="true" />
        </RowAction>
      ) : (
        gap
      )}
    </div>
  );
}

/**
 * A row's selection checkbox. Shift-click selects the range from the last
 * one clicked. Clicking it never opens the account.
 */
export function SelectBox({
  label,
  checked,
  indeterminate = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: (shift: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      className="size-4 cursor-pointer rounded-sm border-input accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onChange={() => undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
    />
  );
}

export function DemoNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-linked/40 bg-status-linked/8 px-4 py-3">
      <FlaskIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-linked" weight="bold" />
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">Demo vault.</span> These sample accounts use reserved example
        domains and randomly generated passwords. Create a new vault for your real accounts.
      </p>
    </div>
  );
}
