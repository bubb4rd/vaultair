import { LockSimpleIcon } from "@phosphor-icons/react";
import { session, type LockNotice } from "@/ipc/client";
import { toast } from "@/features/toast/toast";

function spell(secs: number): string {
  if (secs % 60 === 0) {
    const m = secs / 60;
    return `${String(m)} minute${m === 1 ? "" : "s"}`;
  }
  return `${String(secs)} seconds`;
}

/** What the lock screen says about why the vault just locked. */
export function lockNoticeText(n: LockNotice): { title: string; description?: string; shortcut?: string[] } {
  switch (n.reason) {
    case "manual":
      return { title: "Vault locked", description: "Lock anytime with", shortcut: ["Ctrl", "L"] };
    case "idle":
      return { title: `Locked after ${spell(n.afterSecs)} of inactivity` };
    case "sessionLocked":
      return { title: "Locked because Windows was locked" };
    case "signedOut":
      return { title: "Locked because you signed out of Windows" };
    case "disconnected":
      return { title: "Locked because the session disconnected" };
    case "sleep":
      return { title: "Locked before your PC went to sleep" };
    case "minimized":
      return { title: "Locked when Vaultair was minimized" };
  }
}

/**
 * The webview reloads on lock, so the reason comes back from Rust (once).
 * Called when the lock screen opens.
 */
export function showLockNotice() {
  session
    .takeLockNotice()
    .then((n) => {
      if (!n) return;
      const { title, ...rest } = lockNoticeText(n);
      toast.info(title, { ...rest, icon: LockSimpleIcon, id: "lock-notice" });
    })
    .catch(() => undefined);
}
