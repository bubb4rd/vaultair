import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { queryKeys, useOpenVault, useVaultSettings } from "@/app/queries";
import { Field, FieldError, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/textarea";
import { toast } from "@/features/toast/toast";
import { settings, toIpcError, type KdfCheck, type SessionConfig, type VaultSettings } from "@/ipc/client";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { SettingsSection, SwitchRow } from "./Section";
import { StrengthenKdfDialog } from "./StrengthenKdfDialog";
import { AUTO_LOCK_MINUTES, CLIPBOARD_SECS, NEVER, REVEAL_SECS, formatMinutes, formatSeconds, withSaved } from "./timings";

/** Lock and clipboard timings. Each change saves at once and applies without a restart. */
function TimingSettings() {
  const queryClient = useQueryClient();
  const saved = useVaultSettings().data;
  const [draft, setDraft] = useState<VaultSettings | null>(null);
  const [confirmNever, setConfirmNever] = useState(false);
  const ticket = useRef(0);

  if (!saved) return null;
  const current = draft ?? saved;

  function save(next: VaultSettings) {
    const mine = ++ticket.current;
    setDraft(next);
    settings
      .update(next)
      .then((config) => {
        if (mine !== ticket.current) return;
        queryClient.setQueryData<VaultSettings>(queryKeys.vaultSettings, next);
        queryClient.setQueryData<SessionConfig>(queryKeys.sessionConfig, config);
        setDraft(null);
      })
      .catch((err: unknown) => {
        if (mine !== ticket.current) return;
        setDraft(null);
        toast.error("Couldn't save the setting", { description: toIpcError(err).message });
      });
  }

  const autoLock = current.autoLockMinutes === null ? NEVER : String(current.autoLockMinutes);
  return (
    <>
      <Field
        id="auto-lock"
        label="Lock after inactivity"
        help={
          current.autoLockMinutes === null
            ? "Never locks on its own. Lock it with Ctrl+L or the lock button."
            : "Counted from your last click or key press in Vaultair."
        }
      >
        <NativeSelect
          id="auto-lock"
          value={autoLock}
          aria-describedby={describedBy("auto-lock", { help: true })}
          onChange={(event) => {
            const value = event.target.value;
            if (value === NEVER) setConfirmNever(true);
            else save({ ...current, autoLockMinutes: Number(value) });
          }}
        >
          {withSaved(AUTO_LOCK_MINUTES, current.autoLockMinutes).map((m) => (
            <option key={m} value={String(m)}>
              {formatMinutes(m)}
            </option>
          ))}
          <option value={NEVER}>Never</option>
        </NativeSelect>
      </Field>
      <SwitchRow
        id="lock-on-session-lock"
        label="Lock when Windows locks"
        help="Win+L, signing out, or a remote session disconnecting."
        checked={current.lockOnSessionLock}
        onCheckedChange={(on) => {
          save({ ...current, lockOnSessionLock: on });
        }}
      />
      <SwitchRow
        id="lock-on-sleep"
        label="Lock when the PC sleeps"
        help="Before Windows goes to sleep or hibernates."
        checked={current.lockOnSleep}
        onCheckedChange={(on) => {
          save({ ...current, lockOnSleep: on });
        }}
      />
      <SwitchRow
        id="lock-on-minimize"
        label="Lock when minimized"
        help="As soon as the Vaultair window is minimized."
        checked={current.lockOnMinimize}
        onCheckedChange={(on) => {
          save({ ...current, lockOnMinimize: on });
        }}
      />
      <Field
        id="clipboard-clear"
        label="Clear copied values after"
        help="Vaultair clears the clipboard after this long, and when the vault locks, unless you copied something else since."
      >
        <NativeSelect
          id="clipboard-clear"
          value={String(current.clipboardClearSecs)}
          aria-describedby={describedBy("clipboard-clear", { help: true })}
          onChange={(event) => {
            save({ ...current, clipboardClearSecs: Number(event.target.value) });
          }}
        >
          {withSaved(CLIPBOARD_SECS, current.clipboardClearSecs).map((s) => (
            <option key={s} value={String(s)}>
              {formatSeconds(s)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="reveal-hide" label="Hide revealed passwords after" help="Passwords, codes and secret fields you show.">
        <NativeSelect
          id="reveal-hide"
          value={String(current.revealHideSecs)}
          aria-describedby={describedBy("reveal-hide", { help: true })}
          onChange={(event) => {
            save({ ...current, revealHideSecs: Number(event.target.value) });
          }}
        >
          {withSaved(REVEAL_SECS, current.revealHideSecs).map((s) => (
            <option key={s} value={String(s)}>
              {formatSeconds(s)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Dialog open={confirmNever} onOpenChange={setConfirmNever}>
        <DialogContent className="max-w-md bg-popover">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Never lock after inactivity?</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              The vault stays open until you lock it, or Windows locks or sleeps with those settings on. Anyone who
              uses this PC while it is open can see your accounts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirmNever(false);
              }}
            >
              Keep auto-lock
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmNever(false);
                save({ ...current, autoLockMinutes: null });
              }}
            >
              Never lock on its own
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The master password and how strongly it is turned into the vault key. */
function MasterPassword() {
  const vault = useOpenVault();
  const [changeOpen, setChangeOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [check, setCheck] = useState<KdfCheck | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!vault) return null;

  async function measure() {
    setMeasuring(true);
    setResult(null);
    try {
      const next = await settings.kdfCheck();
      if (next.canStrengthen) setCheck(next);
      else
        setResult({
          ok: true,
          text: "Already as strong as this PC can unlock in about a second.",
        });
    } catch (err) {
      setResult({ ok: false, text: toIpcError(err).message });
    } finally {
      setMeasuring(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">Master password</h3>
      <dl className="text-[13px]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Key derivation</dt>
          <dd className="font-mono" data-testid="kdf-summary">
            {vault.kdfSummary}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setChangeOpen(true);
          }}
        >
          Change master password
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={measuring} onClick={() => void measure()}>
          {measuring ? "Measuring this PC…" : "Strengthen key derivation"}
        </Button>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {result &&
          (result.ok ? (
            <p className="flex items-start gap-1.5 text-[13px] text-status-secure">
              <CheckCircleIcon aria-hidden="true" weight="fill" className="mt-0.5 size-3.5 shrink-0" />
              <span>{result.text}</span>
            </p>
          ) : (
            <FieldError>{result.text}</FieldError>
          ))}
      </div>
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />
      <StrengthenKdfDialog
        check={check}
        onClose={() => {
          setCheck(null);
        }}
      />
    </div>
  );
}

/** Settings > Security: auto-lock, clipboard and reveal timings, and the master password. */
export function SecuritySettings() {
  return (
    <SettingsSection id="security" title="Security">
      <TimingSettings />
      <MasterPassword />
    </SettingsSection>
  );
}
