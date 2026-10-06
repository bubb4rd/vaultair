import { QueryClient, keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accounts,
  backup,
  catalog,
  contactPoints,
  dashboard,
  gameProfiles,
  graph,
  health,
  identities,
  EMPTY_FILTER,
  DEFAULT_SORT,
  recentVaults,
  search,
  session,
  vault,
  type AccountDetail,
  type AccountFilter,
  type AccountSort,
  type GameProfileFilter,
  type GraphFocus,
  type HealthRule,
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
  accountList: (filter: AccountFilter, sort: AccountSort = DEFAULT_SORT) =>
    ["accounts", "list", filter, sort] as const,
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
  health: ["health"] as const,
  healthSummary: (identityId: string | null) => ["health", "summary", identityId ?? "all"] as const,
  healthIssues: (identityId: string | null, rule: HealthRule | null) =>
    ["health", "issues", identityId ?? "all", rule ?? "all"] as const,
  graph: ["graph"] as const,
  graphQuery: (focus: GraphFocus) => ["graph", focus.kind, focus.id] as const,
  catalog: ["catalog"] as const,
  platforms: ["catalog", "platforms"] as const,
  games: ["catalog", "games"] as const,
  gameProfiles: ["gameProfiles"] as const,
  gameProfileList: (filter: GameProfileFilter) => ["gameProfiles", filter] as const,
  savedViews: ["savedViews"] as const,
  backupStatus: ["backup", "status"] as const,
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

/** Where backups go and how the last one went. Refetched after each backup. */
export function useBackupStatus() {
  return useQuery({ queryKey: queryKeys.backupStatus, queryFn: backup.status });
}

/** Every active account, or every archived one, by title. */
export function useAccounts(archived = false) {
  return useAccountList(archived ? { ...EMPTY_FILTER, archived } : EMPTY_FILTER);
}

/**
 * Accounts matching a filter (run in Rust), in `sort` order. While a new
 * filter loads, the previous rows stay on screen instead of blinking out.
 */
export function useAccountList(filter: AccountFilter, sort: AccountSort = DEFAULT_SORT) {
  return useQuery({
    queryKey: queryKeys.accountList(filter, sort),
    queryFn: () => accounts.list(filter, sort),
    placeholderData: keepPreviousData,
  });
}

/** Built-in saved views first, then the user's. */
export function useSavedViews() {
  return useQuery({ queryKey: queryKeys.savedViews, queryFn: search.views });
}

export function useAccount(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.account(id), queryFn: () => accounts.get(id), enabled });
}

/** Every purpose label, hidden ones included, in display order. */
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

/** Every platform, with how many accounts and profiles use each. */
export function usePlatforms() {
  return useQuery({ queryKey: queryKeys.platforms, queryFn: catalog.platforms });
}

/** Every game, with how many accounts and profiles use each. */
export function useGames() {
  return useQuery({ queryKey: queryKeys.games, queryFn: catalog.games });
}

export function useGameProfiles(filter: GameProfileFilter) {
  return useQuery({ queryKey: queryKeys.gameProfileList(filter), queryFn: () => gameProfiles.list(filter) });
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

export function useHealthSummary(identityId: string | null) {
  return useQuery({
    queryKey: queryKeys.healthSummary(identityId),
    queryFn: () => health.summary(identityId),
  });
}

/** `rule` null is every check. Archived accounts are never included. */
export function useHealthIssues(identityId: string | null, rule: HealthRule | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.healthIssues(identityId, rule),
    queryFn: () => health.issues(identityId, rule),
    enabled,
  });
}

/** The relationship map around `focus`; null waits for one. The last map stays up while the next loads. */
export function useGraph(focus: GraphFocus | null) {
  return useQuery({
    queryKey: focus ? queryKeys.graphQuery(focus) : queryKeys.graph,
    queryFn: () => (focus ? graph.query(focus) : null),
    enabled: focus !== null,
    placeholderData: keepPreviousData,
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
  void queryClient.invalidateQueries({ queryKey: queryKeys.health });
  void queryClient.invalidateQueries({ queryKey: queryKeys.graph });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
  void queryClient.invalidateQueries({ queryKey: queryKeys.gameProfiles });
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

/**
 * After a purpose label write: the labels themselves, and everything that
 * names an account's purpose (a rename or a delete moves or renames it),
 * account details included.
 */
export function usePurposesChanged() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.purposes });
    void queryClient.invalidateQueries({ queryKey: queryKeys.savedViews });
    invalidateDerived(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["accounts", "detail"] });
  };
}

/**
 * After a catalog write (a platform or game added or edited) or a game
 * profile change: everything that names or counts catalog entries refetches,
 * account details included.
 */
export function useCatalogChanged() {
  const queryClient = useQueryClient();
  return () => {
    invalidateDerived(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["accounts", "detail"] });
  };
}
