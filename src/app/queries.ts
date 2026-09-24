import { QueryClient, useQuery } from "@tanstack/react-query";
import { recentVaults, vault, type VaultInfo } from "@/ipc/client";

export const queryKeys = {
  vaultStatus: ["vault", "status"] as const,
  recentVaults: ["recentVaults"] as const,
};

/**
 * IPC calls are local and cheap, and data only changes through our own
 * commands, so nothing refetches on its own. The whole cache is cleared on lock.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
}

export function useVaultStatus() {
  return useQuery({ queryKey: queryKeys.vaultStatus, queryFn: vault.status });
}

/** The open vault. Only call inside the unlocked app. */
export function useOpenVault(): VaultInfo | null {
  const { data } = useVaultStatus();
  return data?.state === "unlocked" ? data.vault : null;
}

export function useRecentVaults() {
  return useQuery({ queryKey: queryKeys.recentVaults, queryFn: recentVaults.list });
}
