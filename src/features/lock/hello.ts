import type { PasswordReason } from "@/ipc/client";

/** Why the lock screen asks for the master password although Windows Hello unlock is on. */
export const PASSWORD_REASON_TEXT: Record<PasswordReason, string> = {
  restarted: "Windows restarted, so your master password is needed once. After that, Windows Hello works again.",
  expired:
    "It has been 7 days since you last typed your master password. Enter it once to keep using Windows Hello.",
  tooManyAttempts: "Windows Hello didn't go through 3 times in a row. Enter your master password.",
  helloUnavailable: "Windows Hello isn't available right now. Enter your master password.",
};

/**
 * Whether a Windows Hello prompt would open in front of the user. Rust can
 * show the lock screen while the window is minimized, hidden in the tray or
 * behind the Windows lock screen; the prompt waits until Vaultair is in front.
 */
export function windowIsInFront(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}
