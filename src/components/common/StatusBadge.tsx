import type { Icon } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  CircleDashedIcon,
  InfoIcon,
  LinkSimpleIcon,
  QuestionIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Status semantics from the product spec. A badge always shows an icon AND a
 * text label AND a color, so meaning never depends on color alone.
 */
export type Status =
  | "secure"
  | "attention"
  | "warning"
  | "risk"
  | "dormant"
  | "archived"
  | "unknown"
  | "linked"
  | "info";

interface StatusSpec {
  icon: Icon;
  label: string;
  /** Text + icon color class; the background is a 12% tint of it. */
  tone: string;
}

export const STATUS: Record<Status, StatusSpec> = {
  secure: { icon: ShieldCheckIcon, label: "Secure", tone: "text-status-secure bg-status-secure/12" },
  attention: {
    icon: WarningCircleIcon,
    label: "Needs attention",
    tone: "text-status-attention bg-status-attention/12",
  },
  warning: { icon: WarningIcon, label: "Warning", tone: "text-status-warning bg-status-warning/12" },
  risk: { icon: ShieldWarningIcon, label: "High risk", tone: "text-status-risk bg-status-risk/12" },
  dormant: { icon: CircleDashedIcon, label: "Dormant", tone: "text-status-dormant bg-status-dormant/12" },
  archived: { icon: ArchiveIcon, label: "Archived", tone: "text-status-dormant bg-status-dormant/12" },
  unknown: { icon: QuestionIcon, label: "Unknown", tone: "text-status-dormant bg-status-dormant/12" },
  linked: { icon: LinkSimpleIcon, label: "Linked", tone: "text-status-linked bg-status-linked/12" },
  info: { icon: InfoIcon, label: "Info", tone: "text-status-linked bg-status-linked/12" },
};

interface StatusBadgeProps {
  status: Status;
  /** Overrides the default label, e.g. "Reused password". Keep it short. */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const spec = STATUS[status];
  const Icon = spec.icon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        spec.tone,
        className,
      )}
    >
      <Icon aria-hidden="true" weight="bold" className="size-3.5 shrink-0" />
      <span>{label ?? spec.label}</span>
    </span>
  );
}
