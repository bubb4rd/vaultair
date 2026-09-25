import { useEffect, useId, useState, type ReactNode } from "react";
import { CopyIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useSessionConfig } from "@/app/queries";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copySecret, copyToClipboard } from "@/features/clipboard/copy";
import { toast } from "@/features/toast/toast";
import { secrets, toIpcError, type SecretRef } from "@/ipc/client";
import { cn } from "@/lib/utils";

/** ADR-0004 decision 11; Rust's setting wins once it has loaded. */
const DEFAULT_REVEAL_SECS = 20;
const MASK = "••••••••••••";

function IconAction({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One labelled row of the detail page: label, value, then its actions.
 * `value` null shows a quiet "Not set".
 */
export function FieldRow({
  label,
  children,
  actions,
  className,
}: {
  label: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={cn("grid min-h-10 grid-cols-[132px_1fr] items-start gap-x-4 py-2", className)}>
      <dt className="pt-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 pt-1 text-[13px] break-words text-foreground">
          {empty ? <span className="text-subtle-foreground">Not set</span> : children}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </dd>
    </div>
  );
}

/** Copies text the page already shows (a username, an email). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <IconAction label={`Copy ${label.toLowerCase()}`} onClick={() => void copyToClipboard(text, label)}>
      <CopyIcon aria-hidden="true" />
    </IconAction>
  );
}

/**
 * A stored secret, hidden by default.
 *
 * - Show: Rust decrypts it; the value lives only in this component's state,
 *   hides itself after `revealHideSecs`, and is dropped on unmount.
 * - Copy: Rust decrypts and writes the clipboard itself; the value never
 *   reaches the page.
 */
export function SecretField({
  label,
  target,
  multiline = false,
  copyLabel,
  canCopy = true,
}: {
  label: string;
  target: SecretRef;
  multiline?: boolean;
  copyLabel?: string;
  canCopy?: boolean;
}) {
  const config = useSessionConfig();
  const hideAfter = config.data?.revealHideSecs ?? DEFAULT_REVEAL_SECS;
  const [revealed, setRevealed] = useState<{ value: string; secondsLeft: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const valueId = useId();

  // Count down once a second while shown, then hide.
  useEffect(() => {
    if (revealed === null) return;
    const t = setTimeout(() => {
      setRevealed((r) => (r === null || r.secondsLeft <= 1 ? null : { ...r, secondsLeft: r.secondsLeft - 1 }));
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [revealed]);

  async function reveal() {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setBusy(true);
    try {
      const value = await secrets.reveal(target);
      setRevealed({ value, secondsLeft: hideAfter });
    } catch (err) {
      toast.error(`Couldn't show the ${label.toLowerCase()}`, { description: toIpcError(err).message });
    } finally {
      setBusy(false);
    }
  }

  const value = revealed?.value ?? null;
  const secondsLeft = revealed?.secondsLeft ?? 0;
  const shown = value !== null;
  return (
    <FieldRow
      label={label}
      actions={
        <>
          <IconAction label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} pressed={shown} disabled={busy} onClick={() => void reveal()}>
            {shown ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </IconAction>
          {canCopy && (
            <IconAction label={`Copy ${label.toLowerCase()}`} onClick={() => void copySecret(target, copyLabel ?? label)}>
              <CopyIcon aria-hidden="true" />
            </IconAction>
          )}
        </>
      }
    >
      <span className="flex flex-col gap-1">
        <span
          id={valueId}
          data-testid="secret-value"
          className={cn(
            "font-mono tracking-wide",
            multiline ? "whitespace-pre-wrap" : "break-all",
            !shown && "text-muted-foreground select-none",
          )}
        >
          {shown ? value : MASK}
        </span>
        {shown && (
          <span className="text-xs text-subtle-foreground" aria-hidden="true">
            Hides in {secondsLeft}s
          </span>
        )}
      </span>
    </FieldRow>
  );
}
