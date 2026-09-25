/**
 * How screens copy. Rust writes the value (kept out of clipboard history)
 * and times the clear; this shows it as one toast with a countdown and
 * "Keep in clipboard" / "Clear now".
 */
import { ClipboardTextIcon } from "@phosphor-icons/react";
import { clipboard, toIpcError } from "@/ipc/client";
import { toast } from "@/features/toast/toast";

/** One clipboard toast at a time: a new copy replaces the last. */
export const CLIPBOARD_TOAST_ID = "clipboard";

function cleared() {
  toast.success("Clipboard cleared", { id: CLIPBOARD_TOAST_ID });
}

/**
 * Copies non-secret text (`label` names it: "Username", "Email"). Resolves
 * false if the copy failed; the toast says why.
 */
export async function copyToClipboard(text: string, label: string): Promise<boolean> {
  try {
    const { clearAfterSecs } = await clipboard.copyPlain(text);
    toast.info(`${label} copied`, {
      id: CLIPBOARD_TOAST_ID,
      icon: ClipboardTextIcon,
      description: "Kept out of clipboard history.",
      duration: null,
      countdown: { endsAt: Date.now() + clearAfterSecs * 1000, totalSecs: clearAfterSecs },
      announce: `${label} copied. It will be cleared from the clipboard in ${String(clearAfterSecs)} seconds.`,
      actions: [
        {
          label: "Keep in clipboard",
          onClick: () => {
            clipboard
              .cancelClear()
              .then(() => {
                toast.success(`${label} kept in clipboard`, {
                  id: CLIPBOARD_TOAST_ID,
                  description: "It stays until you copy something else.",
                });
              })
              .catch(() => undefined);
          },
        },
        {
          label: "Clear now",
          onClick: () => {
            clipboard.clearNow().then(cleared).catch(() => undefined);
          },
        },
      ],
    });
    return true;
  } catch (err) {
    toast.error("Couldn't copy", { id: CLIPBOARD_TOAST_ID, description: toIpcError(err).message });
    return false;
  }
}

/** Rust finished a clear (timer or lock): turn the countdown into a confirmation. */
export function onClipboardClearedByRust() {
  if (toast.get(CLIPBOARD_TOAST_ID)?.countdown) cleared();
}
