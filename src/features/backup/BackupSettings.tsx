import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon, CloudIcon, FolderSimpleIcon, WarningIcon } from "@phosphor-icons/react";
import { queryKeys, useBackupStatus } from "@/app/queries";
import { FieldError } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { toast } from "@/features/toast/toast";
import { backup, toIpcError, vault, type BackupStatus, type BackupSummary } from "@/ipc/client";
import { formatDateTime, formatSize, PROVIDER_NAMES, reminderText } from "./labels";
import { RestoreDialog } from "./RestoreDialog";

type Busy = "folder" | "backup" | "check" | null;

/**
 * Settings > Backups: where backups go, "Back up now", how the last one
 * went, checking a backup file and restoring one.
 */
export function BackupSettings() {
  const queryClient = useQueryClient();
  const status = useBackupStatus().data;
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [intact, setIntact] = useState<BackupSummary | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // No vault settings to show (the query is still loading, or failed).
  if (!status) return null;

  function begin(what: Exclude<Busy, null>) {
    setBusy(what);
    setError(null);
    setIntact(null);
  }

  async function chooseFolder() {
    begin("folder");
    try {
      const picked = await vault.pickFolder("backupDestination");
      if (picked) {
        const next = await backup.setDestination(picked);
        queryClient.setQueryData<BackupStatus>(queryKeys.backupStatus, next);
      }
    } catch (err) {
      const ipc = toIpcError(err);
      setError(
        ipc.field === "destination"
          ? "Choose a folder outside this vault's own folder. A backup kept inside the vault is lost with it."
          : ipc.message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function backUpNow() {
    begin("backup");
    try {
      const made = await backup.create();
      toast.success("Backup saved and checked", { description: made.fileName });
    } catch (err) {
      setError(toIpcError(err).message);
    } finally {
      // Success or failure, Rust recorded the attempt.
      void queryClient.invalidateQueries({ queryKey: queryKeys.backupStatus });
      setBusy(null);
    }
  }

  async function checkBackup() {
    begin("check");
    try {
      const picked = await backup.pickFile();
      if (picked) setIntact(await backup.verify(picked.path));
    } catch (err) {
      setError(toIpcError(err).message);
    } finally {
      setBusy(null);
    }
  }

  const cloud = status.cloudProvider ? PROVIDER_NAMES[status.cloudProvider] : null;
  const missing = status.destination !== null && !status.destinationAvailable;
  const lastFailed = status.lastOutcome === "failed";

  return (
    <section aria-labelledby="backup-heading" className="flex flex-col gap-4">
      <h2 id="backup-heading" className="text-[13px] font-semibold">
        Backups
      </h2>
      <p className="text-[13px] text-muted-foreground">
        A backup is one encrypted file holding this whole vault. It opens with the master password the vault had when
        the backup was made, so keep that password too.
      </p>

      {status.reminderDue && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-status-attention/40 bg-status-attention/8 p-3"
        >
          <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-attention" />
          <p className="text-[13px] text-muted-foreground">
            <span className="font-medium text-status-attention">Backup due.</span> {reminderText(status)}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p id="backup-folder-label" className="text-[13px] font-medium">
          Backup folder
        </p>
        <div
          role="group"
          aria-labelledby="backup-folder-label"
          className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2.5"
        >
          <FolderSimpleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {status.destination ? (
            <span className="min-w-0 font-mono text-[13px] break-all select-text" data-testid="backup-folder">
              {status.destination}
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground" data-testid="backup-folder">
              No folder chosen
            </span>
          )}
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void chooseFolder()}>
            {status.destination ? "Change folder" : "Choose a folder"}
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Use a USB drive or another disk. A backup on the same disk as the vault is lost if that disk fails.
        </p>
        {missing && (
          <FieldError>
            This folder can&apos;t be found. Connect the drive it&apos;s on, or choose another folder.
          </FieldError>
        )}
        {cloud && (
          <div role="alert" className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3">
            <CloudIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-status-warning">This folder is synced by {cloud}.</span> Backups stay
              encrypted, but {cloud} will upload a copy of each one.
            </p>
          </div>
        )}
      </div>

      <dl className="text-[13px]">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <dt className="text-muted-foreground">Last backup</dt>
          <dd data-testid="last-backup">{formatDateTime(status.lastBackupAt) ?? "None yet"}</dd>
          {status.lastBackupPath && (
            <dd className="basis-full font-mono text-xs break-all text-subtle-foreground select-text">
              {status.lastBackupPath}
            </dd>
          )}
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!status.destination || busy !== null} onClick={() => void backUpNow()}>
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void checkBackup()}>
          {busy === "check" ? "Checking…" : "Check a backup"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => {
            setRestoreOpen(true);
          }}
        >
          Restore a backup
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          lastFailed && (
            <FieldError>
              The last attempt{formatDateTime(status.lastAttemptAt) ? `, on ${formatDateTime(status.lastAttemptAt) ?? ""},` : ""}{" "}
              failed. Check the backup folder and try again.
            </FieldError>
          )
        )}
        {intact && (
          <p className="flex items-start gap-1.5 text-[13px] text-status-secure">
            <CheckCircleIcon aria-hidden="true" weight="fill" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {intact.fileName} is intact. Made {formatDateTime(intact.createdAt) ?? "at an unknown time"},{" "}
              {formatSize(intact.sizeBytes)}.
            </span>
          </p>
        )}
      </div>

      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </section>
  );
}
