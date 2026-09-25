import { toIpcError, vault } from "@/ipc/client";
import { toast } from "@/features/toast/toast";

/**
 * Locks the vault (sidebar button, Ctrl+L). Rust closes the database, wipes
 * the keys and emits `vault://locked`; the gate then reloads the webview.
 */
export function lockVault(): void {
  vault.lock().catch((err: unknown) => {
    toast.error("Couldn't lock the vault", { description: toIpcError(err).message });
  });
}
