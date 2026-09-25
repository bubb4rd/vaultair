import { useEffect, useRef, useState, type SubmitEvent } from "react";
import {
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useAccountUpdated, useSessionConfig } from "@/app/queries";
import { Field, describedBy } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, Textarea } from "@/components/ui/textarea";
import { copySecret } from "@/features/clipboard/copy";
import { toast } from "@/features/toast/toast";
import {
  mfa,
  secrets,
  toIpcError,
  type AccountDetail,
  type MfaMethod,
  type MfaView,
} from "@/ipc/client";
import { StoredSecret } from "./AccountForm";
import { MFA_METHODS, formatDate, mfaMethodLabel, usesTotp } from "./labels";
import { FieldRow, SecretField } from "./SecretField";
import { freshSecret, toUpdate, type SecretEdit } from "./secretEdit";

const DEFAULT_REVEAL_SECS = 20;

/** "123 456" for readability; screen readers get the plain digits. */
function groupDigits(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/**
 * The current TOTP code: hidden until shown, then refreshed as each period
 * ends, and hidden again after `revealHideSecs`. Copy goes through Rust.
 */
function TotpCode({ method }: { method: MfaView }) {
  const config = useSessionConfig();
  const hideAfter = config.data?.revealHideSecs ?? DEFAULT_REVEAL_SECS;
  const [code, setCode] = useState<{ code: string; secondsRemaining: number } | null>(null);
  const [visibleFor, setVisibleFor] = useState(0);
  const generation = useRef(0);

  async function fetchCode() {
    const mine = generation.current;
    try {
      const c = await mfa.totpCode(method.id);
      if (mine === generation.current) setCode({ code: c.code, secondsRemaining: c.secondsRemaining });
    } catch (err) {
      toast.error("Couldn't show the code", { description: toIpcError(err).message });
    }
  }

  // Tick once a second while shown: count the code down, refresh it when it
  // expires, and hide everything when the reveal time is up.
  useEffect(() => {
    if (code === null) return;
    const t = setTimeout(() => {
      if (visibleFor <= 1) {
        generation.current += 1;
        setCode(null);
        return;
      }
      setVisibleFor((v) => v - 1);
      if (code.secondsRemaining <= 1) void fetchCode();
      else setCode({ ...code, secondsRemaining: code.secondsRemaining - 1 });
    }, 1000);
    return () => {
      clearTimeout(t);
    };
    // fetchCode reads only refs and props; re-running on its identity would reset the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, visibleFor]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const shown = code !== null;
  return (
    <FieldRow
      label="Current code"
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={shown ? "Hide code" : "Show code"}
            aria-pressed={shown}
            onClick={() => {
              if (shown) {
                generation.current += 1;
                setCode(null);
              } else {
                setVisibleFor(hideAfter);
                void fetchCode();
              }
            }}
          >
            {shown ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Copy code"
            onClick={() => void copySecret({ kind: "totpCode", id: method.id }, "Code")}
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </>
      }
    >
      {shown ? (
        <span className="flex items-baseline gap-3">
          <span className="font-mono text-[15px] tracking-widest" aria-label={code.code}>
            {groupDigits(code.code)}
          </span>
          <span className="text-xs text-subtle-foreground">changes in {code.secondsRemaining}s</span>
        </span>
      ) : (
        <span className="font-mono tracking-widest text-muted-foreground select-none">••• •••</span>
      )}
    </FieldRow>
  );
}

function BackupCodeRow({ methodId, index, used, onUpdated }: {
  methodId: string;
  index: number;
  used: boolean;
  onUpdated: (d: AccountDetail) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const n = String(index + 1);
  return (
    <li className="flex items-center gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="w-14 shrink-0 text-xs text-subtle-foreground">Code {n}</span>
      <span
        className={`min-w-0 flex-1 font-mono text-[13px] ${used ? "text-subtle-foreground line-through" : value ? "" : "text-muted-foreground"}`}
      >
        {value ?? "••••••••"}
      </span>
      {used && <span className="text-xs text-subtle-foreground">Used</span>}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={value ? `Hide code ${n}` : `Show code ${n}`}
        aria-pressed={value !== null}
        onClick={() => {
          if (value !== null) {
            setValue(null);
            return;
          }
          secrets
            .reveal({ kind: "backupCode", id: methodId, index })
            .then(setValue)
            .catch((err: unknown) => {
              toast.error("Couldn't show the code", { description: toIpcError(err).message });
            });
        }}
      >
        {value ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy code ${n}`}
        onClick={() => void copySecret({ kind: "backupCode", id: methodId, index }, `Backup code ${n}`)}
      >
        <CopyIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant={used ? "ghost" : "outline"}
        size="xs"
        aria-pressed={used}
        onClick={() => {
          mfa
            .markCodeUsed(methodId, index, !used)
            .then(onUpdated)
            .catch((err: unknown) => {
              toast.error("Couldn't update the code", { description: toIpcError(err).message });
            });
        }}
      >
        {used ? "Mark unused" : "Mark used"}
      </Button>
    </li>
  );
}

function BackupCodesDialog({
  method,
  open,
  onOpenChange,
}: {
  method: MfaView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updated = useAccountUpdated();
  const [replacing, setReplacing] = useState(method.backupCodes.length === 0);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    if (!next) {
      setPasted("");
      setError(null);
      setReplacing(method.backupCodes.length === 0);
    }
    onOpenChange(next);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    try {
      const d = await mfa.setBackupCodes(method.id, pasted);
      updated(d);
      setPasted("");
      setReplacing(false);
      toast.success("Backup codes saved", { description: "Encrypted in your vault." });
    } catch (err) {
      const e = toIpcError(err);
      setError(
        e.field === "backupCodes" ? "Paste between 1 and 100 codes, one per line. Each can be up to 64 characters." : e.message,
      );
    }
  }

  async function removeAll() {
    try {
      updated(await mfa.setBackupCodes(method.id, null));
      toast.success("Backup codes removed");
    } catch (err) {
      toast.error("Couldn't remove the codes", { description: toIpcError(err).message });
    }
  }

  const total = method.backupCodes.length;
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-lg bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Backup codes</DialogTitle>
          <DialogDescription className="text-[13px]">
            {total > 0
              ? `${String(method.backupCodesRemaining)} of ${String(total)} left. Mark a code used once you've signed in with it.`
              : "Paste the codes the service gave you. They're encrypted before they're saved."}
          </DialogDescription>
        </DialogHeader>
        {total > 0 && (
          <ul className="max-h-72 overflow-y-auto rounded-md border border-border px-3">
            {method.backupCodes.map((slot) => (
              <BackupCodeRow key={slot.index} methodId={method.id} index={slot.index} used={slot.used} onUpdated={updated} />
            ))}
          </ul>
        )}
        {replacing ? (
          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
            <Field
              id="backup-codes"
              label={total > 0 ? "New codes (replace all)" : "Codes"}
              help="One per line, or separated by commas. Numbering like “1.” is ignored."
              error={error}
            >
              <Textarea
                id="backup-codes"
                value={pasted}
                rows={6}
                className="font-mono"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy("backup-codes", { help: true, error: Boolean(error) })}
                onChange={(e) => {
                  setPasted(e.target.value);
                  setError(null);
                }}
              />
            </Field>
            <DialogFooter>
              {total > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={pasted.trim() === ""}>
                Save codes
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => void removeAll()}>
              <TrashIcon aria-hidden="true" />
              Remove all
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReplacing(true);
              }}
            >
              Replace codes
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MfaDialog({
  accountId,
  method,
  open,
  onOpenChange,
}: {
  accountId: string;
  method: MfaView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updated = useAccountUpdated();
  const [kind, setKind] = useState<MfaMethod>(method?.method ?? "authenticator_app");
  const [enabled, setEnabled] = useState(method?.enabled ?? true);
  const [totp, setTotp] = useState<SecretEdit>(freshSecret(method?.hasTotp ?? false));
  const [recovery, setRecovery] = useState<SecretEdit>(freshSecret(method?.hasRecoveryInstructions ?? false));
  const [notes, setNotes] = useState(method?.notes ?? "");
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  async function revealRecovery() {
    if (!method) return;
    try {
      setRecovery({ mode: "set", value: await secrets.reveal({ kind: "recoveryInstructions", id: method.id }) });
    } catch (err) {
      toast.error("Couldn't open the recovery steps", { description: toIpcError(err).message });
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    try {
      const d = await mfa.upsert(accountId, {
        id: method?.id ?? null,
        method: kind,
        enabled,
        totpSecret: toUpdate(totp),
        recoveryInstructions: toUpdate(recovery),
        notes: notes.trim() === "" ? null : notes,
      });
      updated(d);
      onOpenChange(false);
      toast.success(method ? "MFA details saved" : "MFA method added");
    } catch (err) {
      const e = toIpcError(err);
      if (e.field === "totpSecret") {
        setError({
          field: "totpSecret",
          message: "Enter the setup key as shown by the service (letters A to Z and digits 2 to 7), or an otpauth:// link.",
        });
      } else if (e.field) {
        setError({ field: e.field, message: e.message });
      } else {
        toast.error("Couldn't save the MFA details", { description: e.message });
      }
    }
  }

  const showTotp = usesTotp(kind) || totp.mode !== "set" || totp.value !== "";
  const totpError = error?.field === "totpSecret" ? error.message : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{method ? "Edit MFA method" : "Add MFA method"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              Record how this account's second factor works. Setup keys and recovery steps are encrypted.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <Field id="mfa-method" label="Method">
              <NativeSelect
                id="mfa-method"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as MfaMethod);
                }}
              >
                {MFA_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex h-9 items-center gap-2">
              <Switch id="mfa-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <label htmlFor="mfa-enabled" className="text-[13px] font-medium">
                Turned on
              </label>
            </div>
          </div>
          {showTotp && (
            <div className="flex flex-col gap-2">
              <label htmlFor="mfa-totp" className="text-[13px] font-medium">
                Setup key
              </label>
              {totp.mode === "set" ? (
                <PasswordInput
                  id="mfa-totp"
                  value={totp.value}
                  placeholder="Base32 key or otpauth:// link"
                  aria-invalid={totpError ? true : undefined}
                  aria-describedby={describedBy("mfa-totp", { help: true, error: Boolean(totpError) })}
                  onChange={(e) => {
                    setTotp({ mode: "set", value: e.target.value });
                    setError(null);
                  }}
                />
              ) : (
                <StoredSecret
                  label="setup key"
                  edit={totp}
                  onChange={setTotp}
                  onEdit={() => {
                    setTotp({ mode: "set", value: "" });
                  }}
                />
              )}
              <p id="mfa-totp-help" className="text-[13px] text-muted-foreground">
                The key shown under "can't scan the QR code?". With it, Vaultair shows the same codes as your
                authenticator app.
              </p>
              {totpError && (
                <p id="mfa-totp-error" className="text-[13px] text-status-risk">
                  {totpError}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="mfa-recovery" className="text-[13px] font-medium">
              Recovery steps
            </label>
            {recovery.mode === "set" ? (
              <Textarea
                id="mfa-recovery"
                rows={3}
                value={recovery.value}
                placeholder="How to get back in if you lose this factor"
                onChange={(e) => {
                  setRecovery({ mode: "set", value: e.target.value });
                }}
              />
            ) : (
              <StoredSecret
                label="recovery note"
                editLabel="Edit"
                edit={recovery}
                onChange={setRecovery}
                onEdit={() => void revealRecovery()}
              />
            )}
          </div>
          <Field id="mfa-notes" label="Notes" help="Not encrypted separately. For example which phone or key it's on.">
            <Textarea
              id="mfa-notes"
              rows={2}
              value={notes}
              aria-describedby="mfa-notes-help"
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </Field>
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
            <Button type="submit">{method ? "Save" : "Add method"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MfaCard({ accountId, method }: { accountId: string; method: MfaView }) {
  const updated = useAccountUpdated();
  const [editing, setEditing] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const total = method.backupCodes.length;

  async function remove() {
    try {
      updated(await mfa.delete(method.id));
      toast.success("MFA method removed");
    } catch (err) {
      toast.error("Couldn't remove it", { description: toIpcError(err).message });
    }
  }

  return (
    <li className="rounded-lg border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <ShieldCheckIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-[13px] font-medium">{mfaMethodLabel(method.method)}</h3>
        {method.enabled ? (
          <StatusBadge status="secure" label="On" />
        ) : (
          <StatusBadge status="warning" label="Turned off" />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${mfaMethodLabel(method.method)}`}
          onClick={() => {
            setEditing(true);
          }}
        >
          <PencilSimpleIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${mfaMethodLabel(method.method)}`}
          onClick={() => {
            setConfirmRemove(true);
          }}
        >
          <TrashIcon aria-hidden="true" />
        </Button>
      </div>
      <dl className="px-4 py-1">
        {method.hasTotp && <TotpCode method={method} />}
        {method.hasTotp && <SecretField label="Setup key" target={{ kind: "totpSecret", id: method.id }} />}
        <FieldRow
          label="Backup codes"
          actions={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setCodesOpen(true);
              }}
            >
              {total > 0 ? "Manage" : "Add codes"}
            </Button>
          }
        >
          {total > 0 ? (
            <span>
              {method.backupCodesRemaining} of {total} left
              {method.backupCodesUpdatedAt && (
                <span className="text-subtle-foreground"> · saved {formatDate(method.backupCodesUpdatedAt)}</span>
              )}
            </span>
          ) : null}
        </FieldRow>
        {method.hasRecoveryInstructions && (
          <SecretField label="Recovery steps" multiline target={{ kind: "recoveryInstructions", id: method.id }} />
        )}
        {method.notes && <FieldRow label="Notes">{method.notes}</FieldRow>}
      </dl>
      {editing && <MfaDialog accountId={accountId} method={method} open={editing} onOpenChange={setEditing} />}
      <BackupCodesDialog method={method} open={codesOpen} onOpenChange={setCodesOpen} />
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="max-w-sm bg-popover">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Remove this MFA method?</DialogTitle>
            <DialogDescription className="text-[13px]">
              Its setup key, backup codes and recovery steps are deleted from the vault. The account itself is not
              changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                void remove();
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function MfaSection({ account }: { account: AccountDetail }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="mfa-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="mfa-heading" className="text-[13px] font-semibold">
          MFA and recovery
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add method
        </Button>
      </div>
      {account.mfa.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-[13px] text-muted-foreground">
          No MFA recorded. Add how this account's second factor works, with its setup key and backup codes, so you can
          get back in if you lose your phone.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {account.mfa.map((m) => (
            <MfaCard key={m.id} accountId={account.id} method={m} />
          ))}
        </ul>
      )}
      {adding && <MfaDialog accountId={account.id} method={null} open={adding} onOpenChange={setAdding} />}
    </section>
  );
}

