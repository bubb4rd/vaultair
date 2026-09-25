/**
 * The only module the UI uses to talk to Rust. It wraps the generated
 * commands and normalises every failure into a typed `IpcError`.
 */
import {
  commands,
  type AccountDetail,
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
  type PurposeView,
  type SecretRef,
  type SecretUpdate,
  type TotpCodeView,
  type UrlTarget,
  type AppInfo,
  type ClipboardCopy,
  type CloudProvider,
  type CreateVaultRequest,
  type ErrorCode,
  type FolderPurpose,
  type Generated,
  type IntegrityReport,
  type KdfParams,
  type LockNotice,
  type LocationCheck,
  type PassphraseOptions,
  type PasswordOptions,
  type RecentVault,
  type SessionConfig,
  type StrengthEstimate,
  type VaultInfo,
  type VaultStatus,
} from "./bindings";

export type {
  AccountDetail,
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
  PurposeView,
  SecretRef,
  SecretUpdate,
  TotpCodeView,
  UrlTarget,
  AppInfo,
  ClipboardCopy,
  CloudProvider,
  CreateVaultRequest,
  ErrorCode,
  FolderPurpose,
  Generated,
  IntegrityReport,
  KdfParams,
  LocationCheck,
  LockNotice,
  PassphraseOptions,
  PasswordOptions,
  RecentVault,
  SessionConfig,
  StrengthEstimate,
  VaultInfo,
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
  setCaptureProtection: (enabled: boolean): Promise<SessionConfig> =>
    call(() => commands.captureProtectionSet(enabled)),
  /** Why the vault last locked, once; null after that. */
  takeLockNotice: (): Promise<LockNotice | null> => call(() => commands.sessionTakeLockNotice()),
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

/** Accounts. Responses carry flags about secrets (`hasPassword`), never the secrets. */
export const accounts = {
  list: (archived: boolean): Promise<AccountSummary[]> => data(() => commands.accountList(archived)),
  get: (id: string): Promise<AccountDetail> => data(() => commands.accountGet(id)),
  create: (input: AccountInput): Promise<AccountDetail> => data(() => commands.accountCreate(input)),
  update: (id: string, input: AccountInput): Promise<AccountDetail> => data(() => commands.accountUpdate(id, input)),
  archive: (id: string): Promise<AccountDetail> => data(() => commands.accountArchive(id)),
  unarchive: (id: string): Promise<AccountDetail> => data(() => commands.accountUnarchive(id)),
  setFavorite: (id: string, favorite: boolean): Promise<AccountDetail> =>
    data(() => commands.accountSetFavorite(id, favorite)),
  markVerified: (id: string): Promise<AccountDetail> => data(() => commands.accountMarkVerified(id)),
  /** `confirmTitle` is what the user typed; Rust checks it against the title. */
  delete: (id: string, confirmTitle: string): Promise<null> => data(() => commands.accountDelete(id, confirmTitle)),
  duplicateAsTemplate: (id: string): Promise<AccountDetail> => data(() => commands.accountDuplicateAsTemplate(id)),
  urlTarget: (id: string, which: AccountUrl): Promise<UrlTarget> => data(() => commands.accountUrlTarget(id, which)),
  /** Rust reads the stored URL itself; nothing here can choose what opens. */
  openUrl: (id: string, which: AccountUrl): Promise<null> => data(() => commands.accountOpenUrl(id, which)),
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

export const catalog = {
  purposes: (): Promise<PurposeView[]> => data(() => commands.purposeList()),
  tags: (): Promise<string[]> => data(() => commands.tagList()),
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
