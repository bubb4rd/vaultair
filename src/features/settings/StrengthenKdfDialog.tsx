import { useState, type SubmitEvent } from "react";
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
import { toast } from "@/features/toast/toast";
import { settings, toIpcError, type KdfCheck } from "@/ipc/client";

/**
 * Re-wraps the vault key with the stronger parameters `vault_kdf_check`
 * measured. Same password; it is asked for because Rust needs it to wrap
 * the key again.
 */
export function StrengthenKdfDialog({ check, onClose }: { check: KdfCheck | null; onClose: () => void }) {
  const updated = useVaultInfoUpdated();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setPassword("");
    setPasswordError(null);
    setError(null);
    onClose();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!check || busy) return;
    if (password.length === 0) {
      setPasswordError("Enter your master password.");
      return;
    }
    setBusy(true);
    setError(null);
    setPasswordError(null);
    try {
      updated(await settings.strengthenKdf(password, check.suggested));
      toast.success("Key derivation strengthened", { description: check.suggestedSummary });
      setBusy(false);
      setPassword("");
      onClose();
    } catch (err) {
      const ipc = toIpcError(err);
      setBusy(false);
      if (ipc.code === "wrong_password") setPasswordError(ipc.message);
      else setError(ipc.message);
    }
  }

  return (
    <Dialog
      open={check !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Strengthen key derivation</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              This PC can use more memory to turn your master password into the vault key, which makes each guess
              slower for anyone trying passwords. Your password stays the same.
            </DialogDescription>
          </DialogHeader>
          {check && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Now</dt>
              <dd className="font-mono" data-testid="kdf-current">
                {check.currentSummary}
              </dd>
              <dt className="text-muted-foreground">After</dt>
              <dd className="font-mono" data-testid="kdf-suggested">
                {check.suggestedSummary}
              </dd>
            </dl>
          )}
          <p className="text-[13px] text-muted-foreground">
            Unlocking takes about a second on this PC. A slower PC takes longer to open this vault.
          </p>
          <Field id="kdf-password" label="Master password" error={passwordError}>
            <PasswordInput
              id="kdf-password"
              value={password}
              disabled={busy}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={describedBy("kdf-password", { error: Boolean(passwordError) })}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(null);
              }}
            />
          </Field>
          <div aria-live="polite" className="empty:hidden">
            {error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Strengthening…" : "Strengthen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
