import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { accounts, catalog, recentVaults, session, vault, type AccountDetail, type VaultInfo } from "@/ipc/client";

/**
 * Query keys. Only non-secret DTOs are cached. Revealed secrets and TOTP
 * codes never go through the query cache: they live in component state.
 */
export const queryKeys = {
  vaultStatus: ["vault", "status"] as const,
  recentVaults: ["recentVaults"] as const,
  accounts: ["accounts"] as const,
  accountList: (archived: boolean) => ["accounts", "list", archived ? "archived" : "active"] as const,
  account: (id: string) => ["accounts", "detail", id] as const,
  sessionConfig: ["session", "config"] as const,
  purposes: ["purposes"] as const,
  tags: ["tags"] as const,
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

/** Lock, clipboard and reveal timings (reveal auto-hide uses it). */
export function useSessionConfig() {
  return useQuery({ queryKey: queryKeys.sessionConfig, queryFn: session.config });
}

/** Active accounts, or archived ones. */
export function useAccounts(archived = false) {
  return useQuery({ queryKey: queryKeys.accountList(archived), queryFn: () => accounts.list(archived) });
}

export function useAccount(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.account(id), queryFn: () => accounts.get(id), enabled });
}

export function usePurposes() {
  return useQuery({ queryKey: queryKeys.purposes, queryFn: catalog.purposes });
}

export function useTags() {
  return useQuery({ queryKey: queryKeys.tags, queryFn: catalog.tags });
}

/**
 * After a write that returns the account: store the fresh detail and refetch
 * the lists (they summarise it) and the tag suggestions.
 */
export function useAccountUpdated() {
  const queryClient = useQueryClient();
  return (detail: AccountDetail) => {
    queryClient.setQueryData(queryKeys.account(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: ["accounts", "list"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  };
}

/** After a delete: forget the account and refetch the lists. */
export function useAccountRemoved() {
  const queryClient = useQueryClient();
  return (id: string) => {
    queryClient.removeQueries({ queryKey: queryKeys.account(id) });
    void queryClient.invalidateQueries({ queryKey: ["accounts", "list"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  };
}
