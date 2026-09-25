import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { recent, renderApp, TEST_VAULT } from "@/test/render";

const WRONG = { code: "wrong_password", message: "Incorrect master password." };

describe("lock screen", () => {
  it.each([
    [{ reason: "manual" }, "Vault locked", "Ctrl+L"],
    [{ reason: "idle", afterSecs: 300 }, "Locked after 5 minutes of inactivity", null],
    [{ reason: "sessionLocked" }, "Locked because Windows was locked", null],
    [{ reason: "sleep" }, "Locked before your PC went to sleep", null],
  ])("says why the vault locked (%o)", async (notice, title, shortcut) => {
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { session_take_lock_notice: () => notice },
    });
    const el = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-toast-id="lock-notice"]');
      if (!found) throw new Error("no lock notice yet");
      return found;
    });
    expect(el).toHaveTextContent(title);
    if (shortcut) expect(within(el).getByLabelText(shortcut)).toBeInTheDocument();
  });

  it("confirms removing a vault from the list", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main"), recent("Alts")],
      handlers: { recent_vaults_forget: () => [recent("Main")] },
    });
    await user.click(await screen.findByRole("button", { name: /remove alts/i }));
    expect(await screen.findByText("Removed “Alts” from the list")).toBeInTheDocument();
  });

  it("shows the most recent vault and unlocks it", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main"), recent("Alts")],
      handlers: { vault_unlock: () => TEST_VAULT },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Main" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(calls.find((c) => c.cmd === "vault_unlock")?.args).toEqual({
      path: "C:\\Vaults\\Main",
      password: "orbit lantern cactus mosaic",
    });
  });

  it("shows only the generic message for a wrong password", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: {
        vault_unlock: () => {
          throw WRONG;
        },
      },
    });
    const input = await screen.findByLabelText("Master password");
    await user.type(input, "not it at all");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Incorrect master password.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("asks for the password instead of calling Rust with an empty one", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", { unlocked: false, recents: [recent("Main")] });
    await user.click(await screen.findByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Enter your master password.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "vault_unlock")).toBe(false);
  });

  it("makes you wait after five wrong attempts", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: {
        vault_unlock: () => {
          throw WRONG;
        },
      },
    });
    const input = await screen.findByLabelText("Master password");
    for (let i = 0; i < 5; i++) {
      await waitFor(() => {
        expect(input).toBeEnabled();
      });
      await user.clear(input);
      await user.type(input, `guess ${String(i)}`);
      await user.click(screen.getByRole("button", { name: "Unlock" }));
      await screen.findByText(/Incorrect master password|Too many incorrect attempts/);
    }
    expect(await screen.findByText("Too many incorrect attempts. Try again in 5 s.")).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
  });

  it("switches to another recent vault and can forget one", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main"), recent("Alts"), recent("Old", false)],
      handlers: { recent_vaults_forget: () => [recent("Main"), recent("Alts")] },
    });
    const others = await screen.findByRole("region", { name: "Other vaults" });
    expect(within(others).getByText("Not found")).toBeInTheDocument();

    await user.click(within(others).getByRole("button", { name: /^Alts/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Alts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Old from this list" }));
    await waitFor(() => {
      expect(screen.queryByText("Old")).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.cmd === "recent_vaults_forget")?.args).toEqual({ path: "C:\\Vaults\\Old" });
  });

  it("explains when the vault folder is missing", async () => {
    await renderApp("/", { unlocked: false, recents: [recent("Gone", false)] });
    expect(await screen.findByRole("status")).toHaveTextContent("can't be found");
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("opens a vault picked from disk", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { vault_pick_folder: () => "D:\\Elsewhere\\Travel" },
    });
    await user.click(await screen.findByRole("button", { name: "Open a different vault" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Travel" })).toBeInTheDocument();
    expect(calls.find((c) => c.cmd === "vault_pick_folder")?.args).toEqual({ purpose: "existingVault" });
  });

  it("goes to onboarding to create a new vault", async () => {
    const user = userEvent.setup();
    await renderApp("/", { unlocked: false, recents: [recent("Main")] });
    await user.click(await screen.findByRole("button", { name: "Create a new vault" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Set up your vault" })).toBeInTheDocument();
  });

  it("has no title bar, only a drag strip with window controls", async () => {
    await renderApp("/", { unlocked: false, recents: [recent("Main")] });
    await screen.findByRole("heading", { level: 1, name: "Main" });
    const controls = screen.getByRole("group", { name: "Window" });
    expect(controls.parentElement).toHaveAttribute("data-tauri-drag-region");
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/", { unlocked: false, recents: [recent("Main"), recent("Alts")] });
    await screen.findByRole("heading", { level: 1, name: "Main" });
    expect(await axeViolations(container)).toEqual([]);
  });
});
