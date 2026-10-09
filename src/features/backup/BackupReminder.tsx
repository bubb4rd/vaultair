import { Link } from "@tanstack/react-router";
import { WarningIcon } from "@phosphor-icons/react";
import { PAGE_PATHS } from "@/app/nav";
import { useBackupStatus } from "@/app/queries";
import { Button } from "@/components/ui/button";
import { reminderText } from "./labels";

/** A line on the dashboard while the vault has no recent backup. */
export function BackupReminder() {
  const status = useBackupStatus().data;
  if (!status?.reminderDue) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-status-attention/40 bg-status-attention/8 px-3.5 py-2.5"
    >
      <WarningIcon aria-hidden="true" className="size-4 shrink-0 text-status-attention" />
      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-status-attention">Backup due.</span> {reminderText(status)}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to={PAGE_PATHS.settings} hash="backup-heading">
          Back up
        </Link>
      </Button>
    </div>
  );
}
