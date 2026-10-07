import type { PasswordReason } from "@/ipc/client";

/** Why the lock screen asks for the master password although Windows Hello unlock is on. */
export const PASSWORD_REASON_TEXT: Record<PasswordReason, string> = {
  restarted: "Windows restarted, so your master password is needed once. After that, Windows Hello works again.",
  expired:
    "It has been 7 days since you last typed your master password. Enter it once to keep using Windows Hello.",
  tooManyAttempts: "Windows Hello is now disabled. Your master password is required.",
  helloUnavailable: "Windows Hello isn't available right now. Enter your master password.",
};

