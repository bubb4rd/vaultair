/**
 * The only module the UI uses to talk to Rust. It wraps the generated
 * commands and normalises every failure into a typed `IpcError`.
 */
import {
  commands,
  type AccountDetail,
  type AccountFilter,
  type AccountSort,
  type BulkResult,
  type SavedView,
  type SavedViewInput,
  type SearchHit,
  type SortKey,
  type StatusFilter,
  type ViewSpec,
  type GameInput,
  type GameProfileFilter,
  type GameProfileInput,
  type GameProfileView,
  type GameView,
  type NotesSuggestions,
  type PlatformInput,
  type PlatformKind,
  type PlatformView,
  type AccountInput,
  type AccountStatus,
  type AccountSummary,
  type AccountType,
  type AccountUrl,
  type BackupCodeSlot,
  type ContactKind,
  type ContactPointView,
  type ContactRole,
  type DashboardSummary,
  type Dependent,
  type EdgeKind,
  type FocusKind,
  type Graph,
  type GraphEdge,
  type GraphFocus,
  type GraphNode,
  type NodeKind,
  type HealthFix,
  type HealthIssue,
  type HealthRule,
  type HealthSeverity,
  type HealthSummary,
  type IdentityColor,
  type IdentityDeletePlan,
  type IdentityDetail,
  type IdentityInput,
  type IdentityOverview,
  type IdentityRef,
  type IdentitySummary,
  type MailboxSecurity,
  type OverviewAccount,
  type PlatformGroup,
  type RecoveryDependency,
  type SharedEmail,
  type CustomFieldInput,
  type CustomFieldType,
  type CustomFieldView,
  type MfaInput,
  type MfaMethod,
  type MfaView,
  type PurposeColor,
  type PurposeInput,
  type PurposeView,
  type SecretRef,
  type SecretUpdate,
  type TotpCodeView,
  type UrlTarget,
  type AppInfo,
  type BackupOutcome,
  type BackupStatus,
  type BackupSummary,
  type CaptureLevel,
  type CaptureMode,
  type ClipboardCopy,
  type CloudProvider,
  type CreateVaultRequest,
  type ErrorCode,
  type FolderPurpose,
  type Generated,
  type IntegrityReport,
  type KdfCheck,
  type KdfParams,
  type LockNotice,
  type LocationCheck,
  type PassphraseOptions,
  type PasswordOptions,
  type RecentVault,
  type RestoreBackupRequest,
  type RestoredVault,
  type SessionConfig,
  type StrengthEstimate,
  type VaultInfo,
  type VaultProfileInput,
  type VaultSettings,
  type VaultStatus,
} from "./bindings";

export type {
  AccountDetail,
  AccountFilter,
  AccountSort,
  BulkResult,
  SavedView,
  SavedViewInput,
  SearchHit,
  SortKey,
  StatusFilter,
  ViewSpec,
  GameInput,
  GameProfileFilter,
  GameProfileInput,
  GameProfileView,
  GameView,
  NotesSuggestions,
  PlatformInput,
  PlatformKind,
  PlatformView,
  AccountInput,
  AccountStatus,
  AccountSummary,
  AccountType,
  AccountUrl,
  BackupCodeSlot,
  ContactKind,
  ContactPointView,
  ContactRole,
  DashboardSummary,
  Dependent,
  EdgeKind,
  FocusKind,
  Graph,
  GraphEdge,
  GraphFocus,
  GraphNode,
  NodeKind,
  HealthFix,
  HealthIssue,
  HealthRule,
  HealthSeverity,
  HealthSummary,
  IdentityColor,
  IdentityDeletePlan,
  IdentityDetail,
  IdentityInput,
  IdentityOverview,
  IdentityRef,
  IdentitySummary,
  MailboxSecurity,
  OverviewAccount,
  PlatformGroup,
  RecoveryDependency,
  SharedEmail,
  CustomFieldInput,
  CustomFieldType,
  CustomFieldView,
  MfaInput,
  MfaMethod,
  MfaView,
  PurposeColor,
  PurposeInput,
  PurposeView,
  SecretRef,
  SecretUpdate,
  TotpCodeView,
  UrlTarget,
  AppInfo,
  BackupOutcome,
  BackupStatus,
  BackupSummary,
  RestoreBackupRequest,
  RestoredVault,
  CaptureLevel,
  CaptureMode,
  ClipboardCopy,
  CloudProvider,
  CreateVaultRequest,
  ErrorCode,
  FolderPurpose,
  Generated,
  IntegrityReport,
  KdfCheck,
  KdfParams,
  LocationCheck,
  LockNotice,
  PassphraseOptions,
  PasswordOptions,
  RecentVault,
  SessionConfig,
  StrengthEstimate,
  VaultInfo,
  VaultProfileInput,
  VaultSettings,
  VaultStatus,
};

/** Shape of `vaultair_core::AppError` once serialized. */
export interface IpcError {
  code: ErrorCode;
  message: string;
  field?: string;
}

// `satisfies` makes this fail to compile if Rust adds or renames an error code.
const KNOWN_CODES = {
  vault_locked: true,
  invalid_input: true,
  not_found: true,
  internal: true,
  wrong_password: true,
  weak_password: true,
  vault_not_found: true,
  vault_exists: true,
  vault_in_use: true,
  vault_too_new: true,
  vault_corrupted: true,
  clipboard_busy: true,
  invalid_backup: true,
  backup_other_vault: true,
  backup_destination: true,
} as const satisfies Record<ErrorCode, true>;

const FALLBACK: IpcError = {
  code: "internal",
  message: "Something went wrong. Your vault was not changed.",
};

export function isIpcError(value: unknown): value is IpcError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    Object.hasOwn(KNOWN_CODES, v.code) &&
    typeof v.message === "string"
  );
}

/**
 * Anything that isn't a well-formed `AppError` (a Tauri runtime error, a
 * permission denial, a thrown string) becomes the generic internal error, so
 * raw error text never reaches the screen.
 */
export function toIpcError(err: unknown): IpcError {
  return isIpcError(err) ? err : FALLBACK;
}

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: unknown };

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    // Rejections are plain `IpcError` objects (not `Error`s), matching what Rust sends.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw toIpcError(err);
  }
}

/** For commands returning `Result`: tauri-specta resolves with `{status}` instead of rejecting. */
async function unwrap<T>(run: () => Promise<Outcome<T>>): Promise<T> {
  const outcome = await call(run);
  if (outcome.status === "ok") return outcome.data;
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw toIpcError(outcome.error);
}

let onDataLocked: (() => void) | null = null;

/**
 * Called when a data command finds the vault locked: it locked between the
 * page loading and the call (idle, Win+L). `VaultGate` registers the same
 * cleanup it runs on `vault://locked`. Returns an unsubscribe function.
 */
export function onVaultLockedError(handler: () => void): () => void {
  onDataLocked = handler;
  return () => {
    if (onDataLocked === handler) onDataLocked = null;
  };
}

/** `unwrap` for commands that need an unlocked vault. */
async function data<T>(run: () => Promise<Outcome<T>>): Promise<T> {
  try {
    return await unwrap(run);
  } catch (err) {
    if (isIpcError(err) && err.code === "vault_locked") onDataLocked?.();
    throw err;
  }
}

export const appInfo = (): Promise<AppInfo> => call(() => commands.appInfo());

export const vault = {
  calibrateKdf: (): Promise<KdfParams> => unwrap(() => commands.vaultKdfCalibrate()),
  create: (request: CreateVaultRequest): Promise<VaultInfo> => unwrap(() => commands.vaultCreate(request)),
  unlock: (path: string, password: string): Promise<VaultInfo> =>
    unwrap(() => commands.vaultUnlock(path, password)),
  lock: (): Promise<boolean> => unwrap(() => commands.vaultLock()),
  status: (): Promise<VaultStatus> => call(() => commands.vaultStatus()),
  integrityCheck: (): Promise<IntegrityReport> => unwrap(() => commands.vaultIntegrityCheck()),
  createDemo: (request: CreateVaultRequest): Promise<VaultInfo> =>
    unwrap(() => commands.vaultCreateDemo(request)),
  /** `location` null means the default folder. */
  checkLocation: (location: string | null, name: string): Promise<LocationCheck> =>
    unwrap(() => commands.vaultLocationCheck(location, name)),
  /** Resolves null if the user cancels the dialog. */
  pickFolder: (purpose: FolderPurpose): Promise<string | null> => unwrap(() => commands.vaultPickFolder(purpose)),
};

/**
 * Encrypted backups. Making and checking one need the unlocked vault;
 * choosing a file and restoring don't, so the lock screen can offer them.
 */
export const backup = {
  status: (): Promise<BackupStatus> => data(() => commands.backupStatus()),
  /** `null` clears the folder. */
  setDestination: (path: string | null): Promise<BackupStatus> => data(() => commands.backupSetDestination(path)),
  /** Writes a backup and reads it back before resolving. */
  create: (): Promise<BackupSummary> => data(() => commands.backupCreate()),
  verify: (path: string): Promise<BackupSummary> => data(() => commands.backupVerify(path)),
  /** The system file picker. `null` when cancelled. */
  pickFile: (): Promise<BackupSummary | null> => unwrap(() => commands.backupPickFile()),
  restore: (request: RestoreBackupRequest): Promise<RestoredVault> => unwrap(() => commands.backupRestoreTo(request)),
};

export const recentVaults = {
  list: (): Promise<RecentVault[]> => call(() => commands.recentVaultsList()),
  /** Removes the entry only; the vault's files are untouched. Returns the new list. */
  forget: (path: string): Promise<RecentVault[]> => call(() => commands.recentVaultsForget(path)),
};

/** Scores a candidate master password in Rust. Nothing is stored. */
export const strengthEstimate = (password: string): Promise<StrengthEstimate> =>
  call(() => commands.strengthEstimate(password));

export const session = {
  /** Activity ping for the idle lock. Resolves false if the vault is locked. */
  touch: (): Promise<boolean> => call(() => commands.sessionTouch()),
  config: (): Promise<SessionConfig> => call(() => commands.sessionConfigGet()),
  /** Saves the policy and applies its steady state (Always hides; Off and Custom show). */
  setCapturePolicy: (mode: CaptureMode, level: CaptureLevel): Promise<SessionConfig> =>
    call(() => commands.capturePolicySet(mode, level)),
  /** Saves whether account emails stay masked until shown. */
  setHideEmails: (enabled: boolean): Promise<SessionConfig> => call(() => commands.hideEmailsSet(enabled)),
  /** Hides or shows the window. Ignored unless the saved mode is Custom. */
  applyCapture: (enabled: boolean): Promise<SessionConfig> => call(() => commands.captureApply(enabled)),
  /** Why the vault last locked, once; null after that. */
  takeLockNotice: (): Promise<LockNotice | null> => call(() => commands.sessionTakeLockNotice()),
};

/** The open vault's settings, its name and colour, and its master password. */
export const settings = {
  get: (): Promise<VaultSettings> => data(() => commands.settingsGet()),
  /** Saves and applies the settings at once; resolves the session config they produce. */
  update: (next: VaultSettings): Promise<SessionConfig> => data(() => commands.settingsUpdate(next)),
  updateProfile: (input: VaultProfileInput): Promise<VaultInfo> => data(() => commands.vaultProfileUpdate(input)),
  /** The vault stays unlocked. Rust checks `current` and the policy for `next`. */
  changePassword: (current: string, next: string): Promise<VaultInfo> =>
    data(() => commands.vaultChangePassword(current, next)),
  /** Measures this PC (about a second) against the vault's KDF. */
  kdfCheck: (): Promise<KdfCheck> => data(() => commands.vaultKdfCheck()),
  strengthenKdf: (password: string, kdf: KdfParams): Promise<VaultInfo> =>
    data(() => commands.vaultStrengthenKdf(password, kdf)),
  logsFolder: (): Promise<string | null> => call(() => commands.logsFolder()),
  openLogs: (): Promise<null> => unwrap(() => commands.logsOpen()),
};

/**
 * Copies go through Rust, which keeps them out of clipboard history and
 * clears them automatically. Never use `navigator.clipboard` for vault data.
 */
export const clipboard = {
  /** Text the UI already shows: a username, an email, a freshly generated password. */
  copyPlain: (text: string): Promise<ClipboardCopy> => unwrap(() => commands.clipboardCopyPlain(text)),
  /** "Keep in clipboard": stops the pending clear. */
  cancelClear: (): Promise<boolean> => call(() => commands.clipboardCancelClear()),
  clearNow: (): Promise<boolean> => unwrap(() => commands.clipboardClearNow()),
};

/** Password and passphrase generator. Rust draws from OS randomness; nothing is stored. */
export const generator = {
  password: (options: PasswordOptions): Promise<Generated> => unwrap(() => commands.generatePassword(options)),
  passphrase: (options: PassphraseOptions): Promise<Generated> => unwrap(() => commands.generatePassphrase(options)),
};

/** No filter: every active account. Rust fills in omitted fields the same way. */
export const EMPTY_FILTER: AccountFilter = {
  text: null,
  archived: false,
  identityIds: [],
  purposeIds: [],
  platformIds: [],
  gameIds: [],
  publishers: [],
  statuses: [],
  tags: [],
  mfa: null,
  recoveryCodes: null,
  favorite: null,
  notVerifiedInDays: null,
  updatedInDays: null,
  usesPrimaryEmail: false,
  highPriority: false,
};

export const DEFAULT_SORT: AccountSort = { key: "title", descending: false };

/** Accounts. Responses carry flags about secrets (`hasPassword`), never the secrets. */
export const accounts = {
  /** Filters (the versioned filter language) are validated and run in Rust. */
  list: (filter: AccountFilter = EMPTY_FILTER, sort: AccountSort = DEFAULT_SORT): Promise<AccountSummary[]> =>
    data(() => commands.accountList(filter, sort)),
  get: (id: string): Promise<AccountDetail> => data(() => commands.accountGet(id)),
  create: (input: AccountInput): Promise<AccountDetail> => data(() => commands.accountCreate(input)),
  update: (id: string, input: AccountInput): Promise<AccountDetail> => data(() => commands.accountUpdate(id, input)),
  archive: (id: string): Promise<AccountDetail> => data(() => commands.accountArchive(id)),
  unarchive: (id: string): Promise<AccountDetail> => data(() => commands.accountUnarchive(id)),
  setFavorite: (id: string, favorite: boolean): Promise<AccountDetail> =>
    data(() => commands.accountSetFavorite(id, favorite)),
  markVerified: (id: string): Promise<AccountDetail> => data(() => commands.accountMarkVerified(id)),
  /** Keep the sensitive notes as they are: no suggestions until they change (ADR-0006). */
  dismissNotesSuggestions: (id: string): Promise<AccountDetail> =>
    data(() => commands.accountDismissNotesSuggestions(id)),
  /** `confirmTitle` is what the user typed; Rust checks it against the title. */
  delete: (id: string, confirmTitle: string): Promise<null> => data(() => commands.accountDelete(id, confirmTitle)),
  duplicateAsTemplate: (id: string): Promise<AccountDetail> => data(() => commands.accountDuplicateAsTemplate(id)),
  urlTarget: (id: string, which: AccountUrl): Promise<UrlTarget> => data(() => commands.accountUrlTarget(id, which)),
  /** Rust reads the stored URL itself; nothing here can choose what opens. */
  openUrl: (id: string, which: AccountUrl): Promise<null> => data(() => commands.accountOpenUrl(id, which)),
  /** All or nothing: an id that no longer exists fails the whole action. */
  bulkTag: (ids: string[], add: string[], remove: string[]): Promise<BulkResult> =>
    data(() => commands.accountBulkTag(ids, add, remove)),
  bulkArchive: (ids: string[], archived: boolean): Promise<BulkResult> =>
    data(() => commands.accountBulkArchive(ids, archived)),
  /** `confirm` is what the user typed; Rust checks it against `bulkDeletePhrase`. */
  bulkDelete: (ids: string[], confirm: string): Promise<BulkResult> =>
    data(() => commands.accountBulkDelete(ids, confirm)),
};

/** What the user types to delete `n` accounts at once. Must match Rust's `bulk_delete_phrase`. */
export function bulkDeletePhrase(n: number): string {
  return n === 1 ? "DELETE 1 ACCOUNT" : `DELETE ${String(n)} ACCOUNTS`;
}

/** Global search over the (secret-free) index, and saved list views. */
export const search = {
  query: (query: string, limit = 20): Promise<SearchHit[]> => data(() => commands.search(query, limit)),
  rebuildIndex: (): Promise<number> => data(() => commands.searchRebuildIndex()),
  views: (): Promise<SavedView[]> => data(() => commands.savedViewList()),
  createView: (input: SavedViewInput): Promise<SavedView> => data(() => commands.savedViewCreate(input)),
  updateView: (id: string, input: SavedViewInput): Promise<SavedView> =>
    data(() => commands.savedViewUpdate(id, input)),
  deleteView: (id: string): Promise<null> => data(() => commands.savedViewDelete(id)),
};

/** Identities, and the accounts assigned to them. */
export const identities = {
  list: (archived: boolean): Promise<IdentitySummary[]> => data(() => commands.identityList(archived)),
  /** Active identities, for pickers. */
  refs: (): Promise<IdentityRef[]> => data(() => commands.identityRefs()),
  get: (id: string): Promise<IdentityDetail> => data(() => commands.identityGet(id)),
  overview: (id: string): Promise<IdentityOverview> => data(() => commands.identityOverview(id)),
  create: (input: IdentityInput): Promise<IdentityDetail> => data(() => commands.identityCreate(input)),
  update: (id: string, input: IdentityInput): Promise<IdentityDetail> =>
    data(() => commands.identityUpdate(id, input)),
  archive: (id: string): Promise<IdentityDetail> => data(() => commands.identityArchive(id)),
  unarchive: (id: string): Promise<IdentityDetail> => data(() => commands.identityUnarchive(id)),
  /** `confirmName` is what the user typed; Rust checks it against the name. */
  delete: (id: string, confirmName: string, plan: IdentityDeletePlan): Promise<null> =>
    data(() => commands.identityDelete(id, confirmName, plan)),
  /** `identityId` null removes the accounts from their identity. Resolves how many changed. */
  assignAccounts: (identityId: string | null, accountIds: string[]): Promise<number> =>
    data(() => commands.identityAssignAccounts(identityId, accountIds)),
};

/** Emails and phones accounts and identities use (for suggestions). */
export const contactPoints = {
  list: (): Promise<ContactPointView[]> => data(() => commands.contactPointList()),
};

export const dashboard = {
  /** `identityId` null means the whole vault. */
  summary: (identityId: string | null): Promise<DashboardSummary> => data(() => commands.dashboardSummary(identityId)),
};

export const health = {
  /** `identityId` null means the whole vault. */
  summary: (identityId: string | null): Promise<HealthSummary> => data(() => commands.healthSummary(identityId)),
  /** `rule` null is every check. */
  issues: (identityId: string | null, rule: HealthRule | null): Promise<HealthIssue[]> =>
    data(() => commands.healthIssues(identityId, rule)),
};

/** The relationship map. Nodes and edges name records and links, never secrets. */
export const graph = {
  /** The focus and what is within two steps of it, up to 300 nodes. */
  query: (focus: GraphFocus): Promise<Graph> => data(() => commands.graphQuery(focus, null, null)),
  /** The whole vault: a tree under every identity, then what no identity reaches. Up to 300 nodes. */
  overview: (): Promise<Graph> => data(() => commands.graphOverview(null)),
  /** Discards the prospective account drawn for an email (`contactId`), or brings it back. */
  setProspectDismissed: (contactId: string, dismissed: boolean): Promise<null> =>
    data(() => commands.graphProspectSetDismissed(contactId, dismissed)),
};

export const catalog = {
  /** Every purpose label, hidden ones included. */
  purposes: (): Promise<PurposeView[]> => data(() => commands.purposeList()),
  tags: (): Promise<string[]> => data(() => commands.tagList()),
  platforms: (): Promise<PlatformView[]> => data(() => commands.platformList()),
  createPlatform: (input: PlatformInput): Promise<PlatformView> => data(() => commands.platformCreate(input)),
  updatePlatform: (id: string, input: PlatformInput): Promise<PlatformView> =>
    data(() => commands.platformUpdate(id, input)),
  games: (): Promise<GameView[]> => data(() => commands.gameList()),
  createGame: (input: GameInput): Promise<GameView> => data(() => commands.gameCreate(input)),
  updateGame: (id: string, input: GameInput): Promise<GameView> => data(() => commands.gameUpdate(id, input)),
};

/**
 * Editing purpose labels (listing is `catalog.purposes`). Built-ins only
 * hide, recolour and move; Rust refuses renaming or deleting them.
 */
export const purposes = {
  create: (input: PurposeInput): Promise<PurposeView> => data(() => commands.purposeCreate(input)),
  update: (id: string, input: PurposeInput): Promise<PurposeView> => data(() => commands.purposeUpdate(id, input)),
  setHidden: (id: string, hidden: boolean): Promise<PurposeView> => data(() => commands.purposeSetHidden(id, hidden)),
  /** `ids` is every label, in the new order. */
  reorder: (ids: string[]): Promise<PurposeView[]> => data(() => commands.purposeReorder(ids)),
  /** `reassignTo` is required when accounts use the label. */
  delete: (id: string, reassignTo: string | null): Promise<null> => data(() => commands.purposeDelete(id, reassignTo)),
};

/** Who you are in one game, on one account. */
export const gameProfiles = {
  list: (filter: GameProfileFilter): Promise<GameProfileView[]> => data(() => commands.gameProfileList(filter)),
  create: (accountId: string, input: GameProfileInput): Promise<GameProfileView> =>
    data(() => commands.gameProfileCreate(accountId, input)),
  update: (id: string, input: GameProfileInput): Promise<GameProfileView> =>
    data(() => commands.gameProfileUpdate(id, input)),
  delete: (id: string): Promise<null> => data(() => commands.gameProfileDelete(id)),
};

/**
 * Stored secrets. `reveal` returns a value for display only: keep it in
 * component state, never in a query cache or store. `copy` never returns
 * the value at all.
 */
export const secrets = {
  reveal: async (target: SecretRef): Promise<string> => (await data(() => commands.secretReveal(target))).value,
  copy: (target: SecretRef): Promise<ClipboardCopy> => data(() => commands.clipboardCopySecret(target)),
};

export const mfa = {
  upsert: (accountId: string, input: MfaInput): Promise<AccountDetail> =>
    data(() => commands.mfaUpsert(accountId, input)),
  delete: (id: string): Promise<AccountDetail> => data(() => commands.mfaDelete(id)),
  /** `null` removes the codes. */
  setBackupCodes: (id: string, codes: string | null): Promise<AccountDetail> =>
    data(() => commands.mfaSetBackupCodes(id, codes)),
  markCodeUsed: (id: string, index: number, used: boolean): Promise<AccountDetail> =>
    data(() => commands.mfaMarkCodeUsed(id, index, used)),
  /** For display with a countdown; like `secrets.reveal`, keep it local. */
  totpCode: (id: string): Promise<TotpCodeView> => data(() => commands.totpCurrentCode(id)),
};
