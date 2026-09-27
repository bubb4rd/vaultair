import type { Status } from "@/components/common/StatusBadge";
import type { CaptureLevel, CaptureMode } from "@/ipc/client";

/** Worse ratings are lower. Secure is never hidden. */
const LEVEL_RANK: Record<CaptureLevel, number> = { risk: 0, warning: 1, attention: 2 };

function accountRank(status: Status): number | null {
  switch (status) {
    case "risk":
    case "warning":
    case "attention":
      return LEVEL_RANK[status];
    case "secure":
      return 3;
    default:
      return null;
  }
}

export const CAPTURE_MODES: { value: CaptureMode; label: string }[] = [
  { value: "always", label: "Always on" },
  { value: "off", label: "Off" },
  { value: "custom", label: "Custom" },
];

export const CAPTURE_LEVELS: { value: CaptureLevel; label: string }[] = [
  { value: "risk", label: "High risk" },
  { value: "warning", label: "Warning and worse" },
  { value: "attention", label: "Needs attention and worse" },
];

/**
 * Whether Custom mode hides the window for an account in this band.
 * Archived and other unscored statuses stay visible.
 */
export function shouldHideCapture(level: CaptureLevel, status: Status): boolean {
  const account = accountRank(status);
  if (account === null) return false;
  return account <= LEVEL_RANK[level];
}

/** Account detail or edit. A new account has no score, so it is left out. */
export function accountIdFromPath(pathname: string): string | null {
  if (pathname === "/accounts/new") return null;
  const match = /^\/accounts\/([^/]+)(?:\/edit)?$/.exec(pathname);
  return match?.[1] ?? null;
}

export interface CaptureView {
  mode: CaptureMode;
  level: CaptureLevel;
  /** Null when the current page is not an open account. */
  accountId: string | null;
  /** Null while that account is still loading. */
  archived: boolean | null;
  /** Null while health issues are still loading. Ignored once the account is archived. */
  status: Status | null;
}

/**
 * Whether the window should be hidden. `null` means the mode is not Custom,
 * so navigation must leave the window as the saved policy set it.
 */
export function wantsWindowHidden(view: CaptureView): boolean | null {
  if (view.mode !== "custom") return null;
  if (view.accountId === null) return false;
  if (view.archived === null) return true;
  if (view.archived) return false;
  if (view.status === null) return true;
  return shouldHideCapture(view.level, view.status);
}

export function captureModeDescription(mode: CaptureMode, level: CaptureLevel): string {
  const rating = CAPTURE_LEVELS.find((item) => item.value === level)?.label ?? "High risk";
  switch (mode) {
    case "always":
      return "Screenshots and screen sharing can't see this window, including the lock screen.";
    case "off":
      return "Screenshots and screen sharing can see this window.";
    case "custom":
      return `This window is hidden only while an open account is rated ${rating}.`;
  }
}
