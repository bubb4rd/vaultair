import { useEffect, useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { onVaultLockedError, type VaultInfo, type VaultStatus } from "@/ipc/client";
import { onVaultLocked } from "@/ipc/events";
import { reloadWebview } from "@/lib/webview";
import { LockScreen } from "@/features/lock/LockScreen";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { queryKeys, useRecentVaults, useVaultStatus } from "./queries";
import type { createAppRouter } from "./router";

type Requested = { kind: "auto" } | { kind: "onboarding" } | { kind: "lock"; path: string | null };

/**
 * Nothing behind the router renders unless Rust says a vault is unlocked.
 * Locked: the lock screen if any vault is known, otherwise onboarding.
 *
 * On `vault://locked` the query cache is cleared and the webview reloaded, so
 * nothing from the unlocked session survives in the JS heap.
 */
export function VaultGate({ router }: { router: ReturnType<typeof createAppRouter> }) {
  const queryClient = useQueryClient();
  const status = useVaultStatus();
  const recents = useRecentVaults();
  const [requested, setRequested] = useState<Requested>({ kind: "auto" });

  useEffect(() => {
    const leave = () => {
      queryClient.clear();
      reloadWebview();
    };
    // The event covers every lock; the error covers a data command that
    // raced one (it found the vault locked before the event arrived).
    const offEvent = onVaultLocked(leave);
    const offError = onVaultLockedError(leave);
    return () => {
      offEvent();
      offError();
    };
  }, [queryClient]);

  if (status.isPending || recents.isPending) {
    return <div className="h-full bg-background" />;
  }

  function enterApp(info: VaultInfo) {
    const next: VaultStatus = { state: "unlocked", vault: info };
    queryClient.setQueryData(queryKeys.vaultStatus, next);
    void queryClient.invalidateQueries({ queryKey: queryKeys.recentVaults });
    setRequested({ kind: "auto" });
  }

  const unlocked = status.data?.state === "unlocked";
  const hasRecents = (recents.data?.length ?? 0) > 0;
  const mode =
    requested.kind === "onboarding"
      ? "onboarding"
      : unlocked
        ? "app"
        : requested.kind === "lock" || hasRecents
          ? "lock"
          : "onboarding";

  switch (mode) {
    case "app":
      return <RouterProvider router={router} />;
    case "lock":
      return (
        <LockScreen
          initialPath={requested.kind === "lock" ? requested.path : null}
          onUnlocked={enterApp}
          onCreateNew={() => {
            setRequested({ kind: "onboarding" });
          }}
        />
      );
    case "onboarding":
      return (
        <Onboarding
          onOpenExisting={() => {
            setRequested({ kind: "lock", path: null });
          }}
          onFinished={(info) => {
            void router.navigate({ to: "/" });
            enterApp(info);
          }}
        />
      );
  }
}
