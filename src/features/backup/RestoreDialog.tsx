import { useEffect, useState, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon, CloudIcon, FileLockIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import { queryKeys } from "@/app/queries";
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
import { Input } from "@/components/ui/input";
import { vaultNameError } from "@/features/onboarding/vaultName";
import { backup, toIpcError, vault, type BackupSummary, type LocationCheck } from "@/ipc/client";
import { formatDateTime, formatSize, PROVIDER_NAMES, restoredName } from "./labels";

interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** On the lock screen the restored vault can be opened straight away. */
  lockScreen?: boolean;
  /** Called with the new vault folder when the dialog closes after a restore. */
  onRestored?: (path: string) => void;
}

function PathBox({ path, labelledBy }: { path: string; labelledBy: string }) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2.5"
    >
      <FolderSimpleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 font-mono text-[13px] break-all select-text">{path}</span>
    </div>
  );
}

/**
 * Restores a backup into a new vault folder. It never changes an existing
 * vault, so it's safe to try. The password is the one the vault had when the
 * backup was made; it stays in this component's state and is cleared when
 * the dialog closes.
 */
export function RestoreDialog({ open, onOpenChange, lockScreen = false, onRestored }: RestoreDialogProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<BackupSummary | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ name: string; location: string | null; result: LocationCheck } | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  const nameError = file ? vaultNameError(name) : null;
  // A check for an earlier name or folder doesn't count.
  const check = checked?.name === name && checked.location === location ? checked.result : null;
  const cloud = check?.cloudProvider ? PROVIDER_NAMES[check.cloudProvider] : null;

  useEffect(() => {
    if (!file || vaultNameError(name)) return;
    let cancelled = false;
    vault
      .checkLocation(location, name)
      .then((result) => {
        if (!cancelled) setChecked({ name, location, result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toIpcError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [file, location, name]);

  function change(next: boolean) {
    if (busy) return;
    if (!next) {
      const path = restored;
      setFile(null);
      setName("");
      setLocation(null);
      setChecked(null);
      setPassword("");
      setError(null);
      setPasswordError(null);
      setRestored(null);
      if (path) onRestored?.(path);
    }
    onOpenChange(next);
  }

  async function chooseFile() {
    setError(null);
    try {
      const picked = await backup.pickFile();
      if (!picked) return;
      setFile(picked);
      if (!file) setName(restoredName(picked.fileName));
    } catch (err) {
      setError(toIpcError(err).message);
    }
  }

  async function chooseFolder() {
    setError(null);
    try {
      const picked = await vault.pickFolder("restoreLocation");
      if (picked) setLocation(picked);
    } catch (err) {
      setError(toIpcError(err).message);
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!file || busy || nameError || !check || check.alreadyExists) return;
    if (password.length === 0) {
      setPasswordError("Enter the master password this backup was made with.");
      return;
    }
    setBusy(true);
    setError(null);
    setPasswordError(null);
    try {
      const result = await backup.restore({ backupPath: file.path, location, name, password });
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.recentVaults });
      setRestored(result.path);
    } catch (err) {
      const ipc = toIpcError(err);
      if (ipc.code === "wrong_password") setPasswordError(ipc.message);
      else setError(ipc.message);
    } finally {
      setBusy(false);
    }
  }

  if (restored) {
    return (
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="max-w-md bg-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <CheckCircleIcon aria-hidden="true" weight="fill" className="size-5 text-status-secure" />
              Backup restored
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              The backup passed every check and is now a vault of its own.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p id="restored-to-label" className="text-[13px] font-medium">
              Restored to
            </p>
            <PathBox path={restored} labelledBy="restored-to-label" />
          </div>
          <p className="text-[13px] text-muted-foreground">
            {lockScreen
              ? "It opens with the master password you just entered."
              : "To open it, lock this vault and choose it on the lock screen. This vault wasn't changed."}
          </p>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                change(false);
              }}
            >
              {lockScreen ? "Open the restored vault" : "Done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Restore a backup</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              A restore makes a new vault from a backup file. It never changes a vault you already have.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <p id="restore-file-label" className="text-[13px] font-medium">
              Backup file
            </p>
            {file && (
              <div
                role="group"
                aria-labelledby="restore-file-label"
                className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2.5"
              >
                <FileLockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-mono text-[13px] break-all select-text">{file.fileName}</p>
                  <p className="text-xs text-subtle-foreground">
                    Made {formatDateTime(file.createdAt) ?? "at an unknown time"} · {formatSize(file.sizeBytes)}
                  </p>
                </div>
              </div>
            )}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>
                {file ? "Choose another file" : "Choose a backup file"}
              </Button>
            </div>
          </div>

          {file && (
            <>
              <Field id="restore-name" label="Name for the restored vault" error={nameError}>
                <Input
                  id="restore-name"
                  value={name}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={describedBy("restore-name", { error: Boolean(nameError) })}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <p id="restore-dir-label" className="text-[13px] font-medium">
                  It will be restored to
                </p>
                <PathBox path={check?.vaultDir ?? " "} labelledBy="restore-dir-label" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFolder()}>
                    Choose another folder
                  </Button>
                  {location !== null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setLocation(null);
                      }}
                    >
                      Use the default folder
                    </Button>
                  )}
                </div>
                {check?.alreadyExists && (
                  <FieldError>
                    A folder named &ldquo;{name}&rdquo; already has files in it here. Change the name or choose another
                    folder.
                  </FieldError>
                )}
                {cloud && (
                  <div role="alert" className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3">
                    <CloudIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
                    <p className="text-[13px] text-muted-foreground">
                      <span className="font-medium text-status-warning">This folder is synced by {cloud}.</span> The
                      restored vault stays encrypted, but {cloud} will upload a copy of it.
                    </p>
                  </div>
                )}
              </div>

              <Field
                id="restore-password"
                label="Master password"
                help="The master password this vault had when the backup was made."
                error={passwordError}
              >
                <PasswordInput
                  id="restore-password"
                  value={password}
                  disabled={busy}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={describedBy("restore-password", { help: true, error: Boolean(passwordError) })}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                />
              </Field>
            </>
          )}

          <div aria-live="polite" className="empty:hidden">
            {error && <FieldError>{error}</FieldError>}
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
            <Button type="submit" disabled={!file || busy || Boolean(nameError) || !check || check.alreadyExists}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
