import { render, screen } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { App } from "@/app/App";
import { createQueryClient } from "@/app/queries";
import { createAppRouter } from "@/app/router";
import type { RecentVault, SessionConfig, VaultInfo } from "@/ipc/client";

export const TEST_VAULT: VaultInfo = {
  vaultId: "0193a1b2-0000-7000-8000-000000000001",
  name: "Main",
  path: "C:\\Users\\sam\\AppData\\Local\\Vaultair\\Vaults\\Main",
  kdfSummary: "Argon2id 256 MiB, t=3, p=4",
  createdAt: "2026-09-24T10:00:00Z",
  demo: false,
};

/** ADR-0004 defaults, as Rust reports them. */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  idleLockSecs: 300,
  lockOnSessionLock: true,
  lockOnSleep: true,
  lockOnMinimize: false,
  clipboardClearSecs: 30,
  revealHideSecs: 20,
  captureProtection: true,
};

export const recent = (name: string, available = true): RecentVault => ({
  path: `C:\\Vaults\\${name}`,
  name,
  lastOpenedAt: "2026-09-24T10:00:00Z",
  available,
});

type Handler = (args: Record<string, unknown>) => unknown;

export interface RenderOptions {
  /** Whether Rust reports a vault as unlocked. Default true. */
  unlocked?: boolean;
  recents?: RecentVault[];
  /** Per-command overrides; throw inside to simulate a Rust error. */
  handlers?: Record<string, Handler>;
}

/** Renders the whole app at `path` with Tauri IPC and events mocked. */
export async function renderApp(path = "/", { unlocked = true, recents = [], handlers = {} }: RenderOptions = {}) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      calls.push({ cmd, args: a });
      const override = handlers[cmd];
      if (override) return override(a);
      switch (cmd) {
        case "app_info":
          return { name: "Vaultair", version: "0.1.0", buildProfile: "debug" };
        case "vault_status":
          return unlocked ? { state: "unlocked", vault: TEST_VAULT } : { state: "locked" };
        case "recent_vaults_list":
          return recents;
        case "session_touch":
          return unlocked;
        case "session_config_get":
          return DEFAULT_SESSION_CONFIG;
        case "clipboard_copy_plain":
          return { clearAfterSecs: DEFAULT_SESSION_CONFIG.clipboardClearSecs };
        case "plugin:window|is_maximized":
          return false;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const queryClient = createQueryClient();
  const result = render(<App router={router} queryClient={queryClient} />);
  if (unlocked) {
    await screen.findByRole("navigation", { name: "Main" });
    await router.load();
  }
  return { ...result, router, queryClient, calls };
}
