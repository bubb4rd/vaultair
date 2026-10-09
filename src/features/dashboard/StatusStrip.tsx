import type { Icon } from "@phosphor-icons/react";
import { IdentificationBadgeIcon, PlusIcon, StarIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PAGE_PATHS } from "@/app/nav";
import { useBackupStatus, useOpenVault } from "@/app/queries";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IdentityChip } from "@/features/identities/IdentityAvatar";
import type { DashboardSummary, IdentityRef } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { MoreLink, bigNumber, link, number, plural } from "./bits";

const dateTime = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const cellLabel = "text-xs font-medium text-muted-foreground";

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "30 hours ago" wording for the backup line, where whole days would hide the gap. */
function sinceBackup(iso: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)} days ago`;
}

interface Segment {
  label: string;
  value: number;
  /** Solid fill for the segment and the swatch in its tooltip. */
  fill: string;
}

/**
 * A proportional bar whose segments explain themselves on hover or focus:
 * the swatch, the label and the count. There is no legend; each segment is
 * focusable and carries the same words for screen readers.
 */
function SegmentBar({ segments, unit }: { segments: Segment[]; unit: string }) {
  const drawn = segments.filter((s) => s.value > 0);
  return (
    <div className="flex h-2 gap-0.5">
      {drawn.length === 0 ? (
        <span className="h-full flex-1 rounded-[3px] bg-muted" />
      ) : (
        drawn.map((s) => {
          const words = `${s.label}: ${plural(s.value, unit)}`;
          return (
            <Tooltip key={s.label}>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={words}
                  className={cn(
                    "h-full min-w-1 rounded-[3px] outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    s.fill,
                  )}
                  style={{ flexGrow: s.value }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="flex items-center gap-1.5 tabular-nums">
                <span aria-hidden="true" className={cn("size-2 rounded-[2px]", s.fill)} />
                {s.label}
                <span className="font-semibold">{number.format(s.value)}</span>
              </TooltipContent>
            </Tooltip>
          );
        })
      )}
    </div>
  );
}

/** One cell of the status strip: a label row, then whatever the cell says. */
function Cell({ id, label, aside, children }: { id: string; label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <div className="flex h-5 items-center justify-between gap-3">
        <h2 id={id} className={cellLabel}>
          {label}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function VaultCell({ summary: s, filtered }: { summary: DashboardSummary; filtered: IdentityRef | undefined }) {
  const vault = useOpenVault();
  const other = Math.max(0, s.totalAccounts - s.mainAccounts - s.altAccounts);
  const parts = [
    { label: "Main", value: s.mainAccounts, fill: "bg-foreground" },
    { label: "Alt", value: s.altAccounts, fill: "bg-muted-foreground" },
    ...(other > 0 ? [{ label: "Other", value: other, fill: "bg-input" }] : []),
  ];
  return (
    <Cell
      id="dashboard-vault"
      label="Vault"
      aside={
        filtered ? (
          <IdentityChip name={filtered.name} color={filtered.color} />
        ) : vault ? (
          <span className="max-w-[55%] truncate text-xs text-subtle-foreground">{vault.name}</span>
        ) : null
      }
    >
      <p className="flex items-baseline gap-2">
        <span className={bigNumber}>{number.format(s.totalAccounts)}</span>
        <span className="text-[13px] text-muted-foreground">{s.totalAccounts === 1 ? "account" : "accounts"}</span>
      </p>
      {/* Main and alt: hover or focus a segment for its count. */}
      <SegmentBar segments={parts} unit="account" />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StarIcon aria-hidden="true" weight="fill" className="size-3 text-status-attention" />
        <span className="font-medium text-foreground tabular-nums">{number.format(s.favorites)}</span>
        {s.favorites === 1 ? "favorite" : "favorites"}
      </p>
    </Cell>
  );
}

function MfaCell({ summary: s }: { summary: DashboardSummary }) {
  const covered = Math.max(0, s.totalAccounts - s.missingMfa);
  const percent = pct(covered, s.totalAccounts);
  const filled = Math.round(percent / 10);
  return (
    <Cell id="dashboard-mfa" label="Protected by MFA">
      <p className="flex items-baseline gap-1.5">
        <span className={cn(bigNumber, "text-status-secure")}>{number.format(percent)}</span>
        <span className="text-[13px] text-muted-foreground">%</span>
      </p>
      <div
        role="img"
        aria-label={`${String(percent)} percent protected by MFA, ${number.format(covered)} of ${plural(s.totalAccounts, "account")}`}
        className="flex h-2 gap-0.5"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn("h-full flex-1 rounded-[3px]", i < filled ? "bg-status-secure" : "bg-muted")} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {s.missingMfa > 0 ? (
          <Link to={PAGE_PATHS.health} className={cn(link, "hover:text-foreground hover:underline")}>
            <span className="font-medium text-foreground">{number.format(s.missingMfa)}</span> without MFA
          </Link>
        ) : (
          "None without MFA"
        )}
      </p>
    </Cell>
  );
}

function BackupCell({ now }: { now: Date }) {
  const status = useBackupStatus().data;
  const last = status?.lastBackupAt ?? null;
  return (
    <Cell
      id="dashboard-backup"
      label="Backup"
      aside={
        <MoreLink to={PAGE_PATHS.settings} hash="backup-heading">
          Backup settings
        </MoreLink>
      }
    >
      <p className="text-[17px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
        {status === undefined ? "Checking" : last ? `Last backup ${sinceBackup(last, now)}` : "No backup yet"}
      </p>
      {last ? (
        <p className="text-xs text-muted-foreground">
          <time dateTime={last} className="font-mono">
            {dateTime.format(new Date(last))}
          </time>
          {status?.destination && <span className="block truncate font-mono text-subtle-foreground">{status.destination}</span>}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Pick a folder in Settings to keep a copy of the vault.</p>
      )}
    </Cell>
  );
}

/** A square action: the icon above its label. The one filled tile is the primary action. */
function ActionTile({ to, icon: TileIcon, label, primary }: { to: string; icon: Icon; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border px-1 text-center text-[11px] leading-[1.25] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border-strong bg-transparent text-foreground hover:bg-muted",
      )}
    >
      <TileIcon aria-hidden="true" className="size-5" />
      {label}
    </Link>
  );
}

/** The two actions, two up. Add account is the one filled tile. */
export function ActionGrid({ className }: { className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2", className)}>
      <li>
        <ActionTile to="/accounts/new" icon={PlusIcon} label="Add account" primary />
      </li>
      <li>
        <ActionTile to="/identities/new" icon={IdentificationBadgeIcon} label="Add identity" />
      </li>
    </ul>
  );
}

function ActionsCell() {
  return (
    <Cell id="dashboard-actions" label="Quick actions">
      {/* Capped so the two tiles stay about 80 px square, close to the other cells' height, at every strip width. */}
      <ActionGrid className="max-w-[168px]" />
    </Cell>
  );
}

/**
 * The four cells in one card. Hairlines between them come from the grid:
 * one column stacks them, two columns pair them, four columns line them up.
 */
export function StatusStrip({ summary, filtered, now }: { summary: DashboardSummary; filtered: IdentityRef | undefined; now: Date }) {
  return (
    <div
      aria-label="Vault status"
      className={cn(
        "grid grid-cols-1 rounded-lg border border-border bg-card min-[720px]:grid-cols-2 min-[1120px]:grid-cols-4",
        "[&>*+*]:border-t [&>*+*]:border-border",
        "min-[720px]:[&>*:nth-child(2)]:border-t-0 min-[720px]:[&>*:nth-child(odd)]:border-r min-[720px]:[&>*:nth-child(odd)]:border-border",
        "min-[1120px]:[&>*+*]:border-t-0 min-[1120px]:[&>*:not(:last-child)]:border-r min-[1120px]:[&>*:not(:last-child)]:border-border",
      )}
    >
      <VaultCell summary={summary} filtered={filtered} />
      <MfaCell summary={summary} />
      <BackupCell now={now} />
      <ActionsCell />
    </div>
  );
}
