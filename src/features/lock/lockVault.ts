import { vault } from "@/ipc/client";

/**
 * Locks the vault (sidebar button, Ctrl+L). Rust closes the database, wipes
 * the keys and emits `vault://locked`; the gate then reloads the webview.
 */
export function lockVault(): void {
  vault.lock().catch(() => undefined);
}
