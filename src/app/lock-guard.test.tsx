import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { reloadWebview } from "@/lib/webview";
import { renderApp } from "@/test/render";
import { queryKeys } from "./queries";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

describe("vault gate", () => {
  it("vault://locked clears the query cache and reloads the webview", async () => {
    const { queryClient } = await renderApp("/");
    expect(queryClient.getQueryData(queryKeys.vaultStatus)).toBeDefined();
    await act(async () => {
      await emit("vault://locked", null);
    });
    await waitFor(() => {
      expect(reloadWebview).toHaveBeenCalledTimes(1);
    });
    expect(queryClient.getQueryData(queryKeys.vaultStatus)).toBeUndefined();
  });

  it("Ctrl+L locks the vault", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/");
    await user.keyboard("{Control>}l{/Control}");
    expect(calls.some((c) => c.cmd === "vault_lock")).toBe(true);
  });

  it("leaves Windows-key shortcuts to the OS", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/");
    // Win+L (Windows lock screen) and Win+K (Cast) must not trigger app shortcuts.
    await user.keyboard("{Meta>}l{/Meta}");
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Control>}{Meta>}l{/Meta}{/Control}");
    expect(calls.some((c) => c.cmd === "vault_lock")).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the sidebar shows the open vault and a Lock button", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/");
    expect(screen.getByText("Main")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(calls.some((c) => c.cmd === "vault_lock")).toBe(true);
  });

  it("never renders app routes while locked", async () => {
    await renderApp("/accounts", { unlocked: false });
    await screen.findByRole("heading", { level: 1, name: "Set up your vault" });
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});
