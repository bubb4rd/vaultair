/**
 * The only module the UI uses to talk to Rust. It re-exports the generated
 * commands and normalises rejections into a typed `IpcError`.
 */
import { commands, type AppInfo, type ErrorCode } from "./bindings";

export type { AppInfo, ErrorCode };

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

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    // Rejections are plain `IpcError` objects (not `Error`s), matching what Rust sends.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw toIpcError(err);
  }
}

export const appInfo = (): Promise<AppInfo> => call(() => commands.appInfo());
