import { formatDate } from "@/features/accounts/labels";
import type { BackupStatus, CloudProvider } from "@/ipc/client";

export const PROVIDER_NAMES: Record<CloudProvider, string> = {
  oneDrive: "OneDrive",
  dropbox: "Dropbox",
  googleDrive: "Google Drive",
  iCloud: "iCloud",
  box: "Box",
};

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "5 Oct 2026, 14:03" in the user's locale and time zone. */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateTimeFormat.format(d);
}

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** "812 KB", "2.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${sizeFormat.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}

/** Why a backup is due. Only meaningful while `status.reminderDue`. */
export function reminderText(status: BackupStatus): string {
  const date = formatDate(status.lastBackupAt);
  return date ? `The last backup was made on ${date}.` : "This vault has no backup yet.";
}

/** A restored vault's suggested name: the backup's vault name, marked as restored. */
export function restoredName(fileName: string): string {
  const stem = fileName.replace(/\.vaultair-backup$/i, "").replace(/-\d{8}-\d{6}(-\d+)?$/, "");
  return `${stem || "Vault"} restored`.slice(0, 64);
}
