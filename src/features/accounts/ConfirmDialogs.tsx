import { useEffect, useState, type SubmitEvent } from "react";
import { ArrowSquareOutIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { Field, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/features/toast/toast";
import { accounts, toIpcError, type AccountUrl, type UrlTarget } from "@/ipc/client";

/**
 * Permanent delete. The user types the account's name; Rust checks the
 * typed text against the title too, so nothing else can delete an account.
 */
export function DeleteConfirmDialog({
  account,
  open,
  onOpenChange,
  onDeleted,
}: {
  account: { id: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === account.title.trim();

  function change(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!matches) {
      setError("Type the account name exactly as shown.");
      return;
    }
    setBusy(true);
    try {
      await accounts.delete(account.id, typed);
      change(false);
      toast.success("Account deleted", { description: account.title });
      onDeleted();
    } catch (err) {
      const e = toIpcError(err);
      setError(e.field === "confirmTitle" ? "Type the account name exactly as shown." : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ShieldWarningIcon aria-hidden="true" weight="fill" className="size-5 text-status-risk" />
              Delete this account permanently?
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              This removes its password, MFA details, backup codes, notes and custom fields from the vault. It can't be
              undone. Archive it instead if you might need it again.
            </DialogDescription>
          </DialogHeader>
          <Field
            id="delete-confirm"
            label={`Type “${account.title}” to confirm`}
            error={error}
          >
            <Input
              id="delete-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("delete-confirm", { error: Boolean(error) })}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || busy}>
              Delete permanently
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Open login page": shows where the link goes before the browser opens it.
 * The host comes from Rust's own parsing of the stored URL, not the page's.
 * Mount it when opening (it loads the target once).
 */
export function OpenUrlDialog({
  accountId,
  which,
  open,
  onOpenChange,
}: {
  accountId: string;
  which: AccountUrl;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [target, setTarget] = useState<UrlTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    accounts
      .urlTarget(accountId, which)
      .then((t) => {
        if (!cancelled) setTarget(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toIpcError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, accountId, which]);

  async function openIt() {
    try {
      await accounts.openUrl(accountId, which);
      onOpenChange(false);
      toast.info("Opened in your browser", target ? { description: target.host } : {});
    } catch (err) {
      toast.error("Couldn't open the browser", { description: toIpcError(err).message });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {which === "login" ? "Open the login page?" : "Open the website?"}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            It opens in your default browser. Vaultair doesn't fill in or send anything; check the address before you
            sign in.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="flex flex-col gap-1 rounded-md border border-border-strong bg-background/40 px-3 py-2.5">
            <span className="text-[15px] font-semibold text-foreground">{target.host}</span>
            <span className="font-mono text-xs break-all text-muted-foreground">{target.url}</span>
          </div>
        )}
        {error && <p className="text-[13px] text-status-risk">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!target} onClick={() => void openIt()}>
            <ArrowSquareOutIcon aria-hidden="true" />
            Open {target?.host ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
