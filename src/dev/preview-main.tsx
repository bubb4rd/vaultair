/**
 * Browser-only preview of the app. Boots the real shell with Tauri IPC
 * mocked and fixture data, so a screen can be checked without a Tauri
 * build. Open http://localhost:1420/dev/preview.html on the Vite dev server.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { App } from "@/app/App";
import { createQueryClient } from "@/app/queries";
import { createAppRouter } from "@/app/router";
import { setHealthTrendSource } from "@/features/dashboard/healthTrend";
import "@/styles/globals.css";
import { ACCOUNTS, BACKUP, HEALTH, HEALTH_TREND, IDENTITIES, ISSUES, detailFor, summaryFor } from "./fixtures";

mockWindows("main");
// The app records no score history yet; the gallery fakes a month of it.
setHealthTrendSource(() => HEALTH_TREND);
mockIPC(
  (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "app_info":
        return { name: "Vaultair", version: "0.1.0", buildProfile: "debug" };
      case "vault_status":
        return {
          state: "unlocked",
          vault: {
            vaultId: "0193a1b2-0000-7000-8000-000000000001",
            name: "Main vault",
            color: "blue",
            path: "C:\\Users\\sam\\AppData\\Local\\Vaultair\\Vaults\\Main",
            kdfSummary: "Argon2id 256 MiB, t=3, p=4",
            createdAt: "2026-09-24T10:00:00Z",
            demo: false,
          },
        };
      case "recent_vaults_list":
        return [];
      case "session_touch":
        return true;
      case "session_config_get":
        return {
          idleLockSecs: 300,
          lockOnSessionLock: true,
          lockOnSleep: true,
          lockOnMinimize: false,
          clipboardClearSecs: 30,
          revealHideSecs: 20,
          hideEmails: false,
          captureMode: "always",
          captureLevel: "risk",
          captureProtection: true,
          keepInTray: false,
        };
      case "settings_get":
        return {
          autoLockMinutes: 5,
          lockOnSessionLock: true,
          lockOnSleep: true,
          lockOnMinimize: false,
          clipboardClearSecs: 30,
          revealHideSecs: 20,
        };
      case "dashboard_summary":
        return summaryFor((a.identityId as string | null | undefined) ?? null);
      case "identity_refs":
        return IDENTITIES;
      case "account_list":
        return ACCOUNTS;
      case "account_get":
        return detailFor(a.id as string);
      case "game_profile_list":
      case "game_list":
      case "platform_list":
        return [];
      case "health_summary":
        return HEALTH;
      case "health_issues":
        return ISSUES;
      case "backup_status":
        return BACKUP;
      case "quick_unlock_offer":
        return false;
      case "clipboard_copy_plain":
        return { clearAfterSecs: 30 };
      case "plugin:window|is_maximized":
        return false;
      case "saved_view_list":
      case "search":
      case "purpose_list":
      case "tag_list":
        return [];
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// `?path=/accounts/a-bnet` opens the preview on a route other than the dashboard.
const initialPath = new URLSearchParams(window.location.search).get("path") ?? "/";
const root = document.getElementById("root");
if (!root) throw new Error("root element missing");
createRoot(root).render(
  <StrictMode>
    <App router={createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }))} queryClient={createQueryClient()} />
  </StrictMode>,
);
