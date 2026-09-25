/**
 * The only module the UI uses to talk to Rust. It wraps the generated
 * commands and normalises every failure into a typed `IpcError`.
 */
import {
  commands,
  type AppInfo,
  type CloudProvider,
  type CreateVaultRequest,
  type ErrorCode,
  type FolderPurpose,
  type IntegrityReport,
  type KdfParams,
  type LocationCheck,
  type RecentVault,
  type StrengthEstimate,
  type VaultInfo,
  type VaultStatus,
} from "./bindings";

export type {
  AppInfo,
  CloudProvider,
  CreateVaultRequest,
  ErrorCode,
  FolderPurpose,
  IntegrityReport,
  KdfParams,
  LocationCheck,
  RecentVault,
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

export const appInfo = (): Promise<AppInfo> => call(() => commands.appInfo());

export const vault = {
  calibrateKdf: (): Promise<KdfParams> => unwrap(() => commands.vaultKdfCalibrate()),
  create: (request: CreateVaultRequest): Promise<VaultInfo> => unwrap(() => commands.vaultCreate(request)),
  unlock: (path: string, password: string): Promise<VaultInfo> =>
    unwrap(() => commands.vaultUnlock(path, password)),
  lock: (): Promise<boolean> => call(() => commands.vaultLock()),
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
