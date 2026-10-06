import { useEffect, useState, type SubmitEvent } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { useVaultInfoUpdated } from "@/app/queries";
import { Field, FieldError, describedBy } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Requirement, StrengthMeter } from "@/features/onboarding/StrengthMeter";
import { toast } from "@/features/toast/toast";
import { settings, strengthEstimate, toIpcError, type StrengthEstimate } from "@/ipc/client";

type Errors = Partial<Record<"current" | "next" | "confirm" | "form", string | undefined>>;

/**
 * Changes the master password. The vault stays unlocked and its data isn't
 * touched: Rust wraps the same key under the new password. The passwords
 * live in this component's state and are cleared when it closes.
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const updated = useVaultInfoUpdated();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [estimate, setEstimate] = useState<StrengthEstimate | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  // Scored in Rust as you type, debounced. Nothing is stored.
  useEffect(() => {
    if (next.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      strengthEstimate(next)
        .then((e) => {
          if (!cancelled) setEstimate(e);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [next]);

  function change(nextOpen: boolean) {
    if (busy) return;
    if (!nextOpen) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setEstimate(null);
      setErrors({});
    }
    onOpenChange(nextOpen);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const found: Errors = {};
    if (current.length === 0) found.current = "Enter your current master password.";
    const score = next.length > 0 ? await strengthEstimate(next).catch(() => null) : null;
    if (!score?.longEnough) found.next = "Use at least 12 characters.";
    else if (!score.meetsPolicy) found.next = "This is too easy to guess. Try a longer passphrase.";
    else if (next === current) found.next = "Choose a password different from the current one.";
    if (confirm !== next) found.confirm = "The two entries don't match.";
    setErrors(found);
    if (found.current) document.getElementById("current-password")?.focus();
    else if (found.next) document.getElementById("changed-password")?.focus();
    else if (found.confirm) document.getElementById("confirm-changed-password")?.focus();
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      updated(await settings.changePassword(current, next));
      toast.success("Master password changed", {
        description: "Make a new backup so you have one that opens with it.",
      });
      setBusy(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      setEstimate(null);
      onOpenChange(false);
    } catch (err) {
      const ipc = toIpcError(err);
      setBusy(false);
      if (ipc.code === "wrong_password") {
        setErrors({ current: ipc.message });
        document.getElementById("current-password")?.focus();
      } else if (ipc.code === "weak_password") {
        setErrors({ next: ipc.message });
      } else {
        setErrors({ form: ipc.message });
      }
    }
  }

  const shown = next.length > 0 ? estimate : null;
  const matches = confirm.length > 0 && confirm === next;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Change master password</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Your vault stays unlocked. Nothing in it changes; only the password that opens it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3">
            <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-status-warning">Old backups keep the old password.</span> A backup made
              before this change still opens only with the password you have now.
            </p>
          </div>

          <Field id="current-password" label="Current master password" error={errors.current}>
            <PasswordInput
              id="current-password"
              value={current}
              disabled={busy}
              aria-invalid={errors.current ? true : undefined}
              aria-describedby={describedBy("current-password", { error: Boolean(errors.current) })}
              onChange={(e) => {
                setCurrent(e.target.value);
                if (errors.current) setErrors((prev) => ({ ...prev, current: undefined }));
              }}
            />
          </Field>
          <Field id="changed-password" label="New master password" error={errors.next}>
            <PasswordInput
              id="changed-password"
              value={next}
              disabled={busy}
              aria-invalid={errors.next ? true : undefined}
              aria-describedby={[describedBy("changed-password", { error: Boolean(errors.next) }), "changed-strength"]
                .filter(Boolean)
                .join(" ")}
              onChange={(e) => {
                setNext(e.target.value);
                if (errors.next) setErrors((prev) => ({ ...prev, next: undefined }));
              }}
            />
          </Field>
          <StrengthMeter id="changed-strength" estimate={shown} />
          <Field id="confirm-changed-password" label="Confirm new master password" error={errors.confirm}>
            <PasswordInput
              id="confirm-changed-password"
              value={confirm}
              disabled={busy}
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={describedBy("confirm-changed-password", { error: Boolean(errors.confirm) })}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }));
              }}
            />
          </Field>
          <ul aria-label="Requirements" className="flex flex-col gap-1.5">
            <Requirement met={shown?.longEnough ?? false}>At least 12 characters</Requirement>
            <Requirement met={(shown?.score ?? 0) >= 3}>Strength of Good or better</Requirement>
            <Requirement met={matches}>Both entries match</Requirement>
          </ul>

          <div aria-live="polite" className="empty:hidden">
            {errors.form && <FieldError>{errors.form}</FieldError>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
