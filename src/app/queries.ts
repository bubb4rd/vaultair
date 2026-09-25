import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accounts,
  catalog,
  contactPoints,
  dashboard,
  identities,
  recentVaults,
  session,
  vault,
  type AccountDetail,
  type IdentityDetail,
  type VaultInfo,
} from "@/ipc/client";

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
  identities: ["identities"] as const,
  identityList: (archived: boolean) => ["identities", "list", archived ? "archived" : "active"] as const,
  identityRefs: ["identities", "refs"] as const,
  identity: (id: string) => ["identities", "detail", id] as const,
  identityOverview: (id: string) => ["identities", "overview", id] as const,
  contactPoints: ["contactPoints"] as const,
  dashboard: ["dashboard"] as const,
  dashboardSummary: (identityId: string | null) => ["dashboard", "summary", identityId ?? "all"] as const,
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

/** Active identities, or archived ones. */
export function useIdentities(archived = false) {
  return useQuery({ queryKey: queryKeys.identityList(archived), queryFn: () => identities.list(archived) });
}

/** Active identities for pickers. */
export function useIdentityRefs() {
  return useQuery({ queryKey: queryKeys.identityRefs, queryFn: identities.refs });
}

export function useIdentity(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.identity(id), queryFn: () => identities.get(id), enabled });
}

export function useIdentityOverview(id: string) {
  return useQuery({ queryKey: queryKeys.identityOverview(id), queryFn: () => identities.overview(id) });
}

export function useContactPoints() {
  return useQuery({ queryKey: queryKeys.contactPoints, queryFn: contactPoints.list });
}

export function useDashboardSummary(identityId: string | null) {
  return useQuery({
    queryKey: queryKeys.dashboardSummary(identityId),
    queryFn: () => dashboard.summary(identityId),
  });
}

/**
 * Everything derived from accounts and identities together: account and
 * identity lists, identity overviews (counts, shared emails), contact points
 * and the dashboard. Cheap to refetch, so any account or identity write
 * marks it all stale.
 */
function invalidateDerived(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["accounts", "list"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.identities });
  void queryClient.invalidateQueries({ queryKey: queryKeys.contactPoints });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
}

/**
 * After a write that returns the account: store the fresh detail and refetch
 * the lists (they summarise it), identity views and the tag suggestions.
 */
export function useAccountUpdated() {
  const queryClient = useQueryClient();
  return (detail: AccountDetail) => {
    queryClient.setQueryData(queryKeys.account(detail.id), detail);
    invalidateDerived(queryClient);
  };
}

/** After a delete: forget the account and refetch the lists. */
export function useAccountRemoved() {
  const queryClient = useQueryClient();
  return (id: string) => {
    queryClient.removeQueries({ queryKey: queryKeys.account(id) });
    invalidateDerived(queryClient);
  };
}

/**
 * After an identity write that returns it: store the fresh detail and
 * refetch what shows it. Account details show the identity's name, so
 * they're marked stale too.
 */
export function useIdentityUpdated() {
  const queryClient = useQueryClient();
  return (detail: IdentityDetail) => {
    queryClient.setQueryData(queryKeys.identity(detail.id), detail);
    invalidateDerived(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["accounts", "detail"] });
  };
}

/** After an identity delete or a bulk assignment: refetch everything that shows identities. */
export function useIdentitiesChanged() {
  const queryClient = useQueryClient();
  return (removedId?: string) => {
    if (removedId) {
      queryClient.removeQueries({ queryKey: queryKeys.identity(removedId) });
      queryClient.removeQueries({ queryKey: queryKeys.identityOverview(removedId) });
    }
    invalidateDerived(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["accounts", "detail"] });
  };
}
