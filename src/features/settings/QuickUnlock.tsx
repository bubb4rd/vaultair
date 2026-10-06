import { useState, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { queryKeys, useOpenVault, useQuickUnlock, useQuickUnlockChanged, useSessionConfig } from "@/app/queries";
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
import { quickUnlock, session, toIpcError, type SessionConfig } from "@/ipc/client";
import { SwitchRow } from "./Section";

type Kind = "enable" | "forget";

const COPY: Record<Kind, { title: string; submit: string; busy: string; done: string; doneDetail: string }> = {
  enable: {
    title: "Turn on Windows Hello unlock",
    submit: "Turn on",
    busy: "Waiting for Windows Hello…",
    done: "Windows Hello unlock is on",
    doneDetail: "Your master password is still needed after a restart and every 7 days.",
  },
  forget: {
    title: "Forget this device?",
    submit: "Forget this device",
    busy: "Forgetting…",
    done: "This device was forgotten",
    doneDetail: "This vault now unlocks with your master password only.",
  },
};

/**
 * Turns Windows Hello unlock on or off for this vault on this PC. Both take
 * the master password, which Rust checks before anything changes. Turning
 * it on then shows the Windows Hello prompt.
 */
function QuickUnlockDialog({
  kind,
  open,
  path,
  hardwareBacked,
  onClose,
}: {
  kind: Kind;
  open: boolean;
  path: string;
  hardwareBacked: boolean;
  onClose: () => void;
}) {
  const changed = useQuickUnlockChanged();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[kind];
  const inputId = `quick-unlock-${kind}-password`;

  function close() {
    if (busy) return;
    setPassword("");
    setPasswordError(null);
    setError(null);
    onClose();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length === 0) {
      setPasswordError("Enter your master password.");
      return;
    }
    setBusy(true);
    setError(null);
    setPasswordError(null);
    try {
      const next = kind === "enable" ? await quickUnlock.enable(password) : await quickUnlock.forget(password);
      changed(path, next);
      toast.success(copy.done, { description: copy.doneDetail });
      setBusy(false);
      setPassword("");
      onClose();
    } catch (err) {
      const ipc = toIpcError(err);
      setBusy(false);
      if (ipc.code === "wrong_password") setPasswordError(ipc.message);
      else if (ipc.code === "quick_unlock_cancelled") setError("Windows Hello was cancelled. Nothing was changed.");
      else setError(ipc.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{copy.title}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              {kind === "enable"
                ? "Once you have unlocked with your master password, your Windows PIN, fingerprint or face can unlock this vault on this PC. Your master password is still asked for after Windows restarts, every 7 days, after 3 failed attempts, and to change security settings."
                : "Windows Hello will stop unlocking this vault on this PC, and you will type your master password each time. You can turn it on again later."}
            </DialogDescription>
          </DialogHeader>
          {kind === "enable" && !hardwareBacked && (
            <div className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3">
              <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
              <p className="text-[13px] text-muted-foreground">
                <span className="font-medium text-status-warning">This PC has no TPM.</span> Windows keeps the Hello key
                in software here, which protects less against someone who has this PC. Your master password stays the
                stronger lock.
              </p>
            </div>
          )}
          <Field id={inputId} label="Master password" error={passwordError}>
            <PasswordInput
              id={inputId}
              value={password}
              disabled={busy}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={describedBy(inputId, { error: Boolean(passwordError) })}
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
              {busy ? copy.busy : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Unlocking with Windows Hello, for this vault on this PC (ADR-0005). */
export function QuickUnlockSettings() {
  const vault = useOpenVault();
  const status = useQuickUnlock(vault?.path ?? null).data ?? null;
  const [dialog, setDialog] = useState<Kind | null>(null);

  if (!vault || !status) return null;
  const available = status.hello === "available";

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">Windows Hello</h3>
      {status.enabled ? (
        <>
          <p className="flex items-start gap-1.5 text-[13px] text-status-secure">
            <CheckCircleIcon aria-hidden="true" weight="fill" className="mt-0.5 size-3.5 shrink-0" />
            <span>On for this vault on this PC.</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            Your Windows PIN, fingerprint or face unlocks this vault. Your master password is still asked for after
            Windows restarts, every 7 days, after 3 failed attempts, and to change security settings. Changing your
            master password turns this off.
          </p>
          {!available && (
            <p className="text-[13px] text-muted-foreground">
              Windows Hello isn&apos;t available right now, so this vault unlocks with your master password.
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDialog("forget");
              }}
            >
              Forget this device
            </Button>
          </div>
        </>
      ) : available ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            Unlock this vault with your Windows PIN, fingerprint or face instead of typing your master password each
            time. It works on this PC only and never replaces your master password.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDialog("enable");
              }}
            >
              Turn on Windows Hello unlock
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Windows Hello isn&apos;t set up on this PC. Set up a PIN, fingerprint or face in Windows Settings, under
          Accounts &gt; Sign-in options, then come back here.
        </p>
      )}
      {(["enable", "forget"] as const).map((kind) => (
        <QuickUnlockDialog
          key={kind}
          kind={kind}
          open={dialog === kind}
          path={vault.path}
          hardwareBacked={status.hardwareBacked}
          onClose={() => {
            setDialog(null);
          }}
        />
      ))}
    </div>
  );
}

/** Whether closing the window keeps Vaultair in the tray. Saved for the app, not the vault. */
export function TraySetting() {
  const queryClient = useQueryClient();
  const config = useSessionConfig().data;
  if (!config) return null;
  return (
    <SwitchRow
      id="keep-in-tray"
      label="Keep running in the tray"
      help="Closing the window locks the vault and keeps Vaultair in the tray, so it opens faster next time. Quit from the tray icon."
      checked={config.keepInTray}
      onCheckedChange={(on) => {
        session
          .setKeepInTray(on)
          .then((next) => {
            queryClient.setQueryData<SessionConfig>(queryKeys.sessionConfig, next);
          })
          .catch((err: unknown) => {
            toast.error("Couldn't save the setting", { description: toIpcError(err).message });
          });
      }}
    />
  );
}
