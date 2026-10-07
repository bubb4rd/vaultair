import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { recent, renderApp, TEST_VAULT } from "@/test/render";

const WRONG = { code: "wrong_password", message: "Incorrect master password." };
const HELLO_READY = { hello: "available", hardwareBacked: true, enabled: true, passwordRequired: null };
const CANCELLED = {
  code: "quick_unlock_cancelled",
  message: "Windows Hello was cancelled. Enter your master password instead.",
};
const HELLO_DISABLED = "Windows Hello is now disabled. Your master password is required.";

describe("lock screen with Windows Hello", () => {
  it("waits for a click before asking Windows Hello", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => HELLO_READY, quick_unlock_unlock: () => TEST_VAULT },
    });
    const hello = await screen.findByRole("button", { name: "Unlock with Windows Hello" });
    expect(calls.some((c) => c.cmd === "quick_unlock_unlock")).toBe(false);
    await user.click(hello);
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "quick_unlock_unlock").map((c) => c.args)).toEqual([
      { path: "C:\\Vaults\\Main" },
    ]);
    expect(calls.some((c) => c.cmd === "vault_unlock")).toBe(false);
  });

  it("falls back to the password when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: {
        quick_unlock_status: () => HELLO_READY,
        quick_unlock_unlock: () => {
          throw CANCELLED;
        },
        vault_unlock: () => TEST_VAULT,
      },
    });
    await user.click(await screen.findByRole("button", { name: "Unlock with Windows Hello" }));
    const cancelled = await screen.findByText("Windows Hello was cancelled.");
    expect(cancelled).toHaveClass("text-center");
    expect(screen.getByRole("button", { name: "Use master password" }).parentElement).toHaveClass("items-center");
    // Hello is still on offer, and nothing asked a second time on its own.
    expect(screen.getByRole("button", { name: "Unlock with Windows Hello" })).toBeEnabled();
    expect(calls.filter((c) => c.cmd === "quick_unlock_unlock")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Use master password" }));
    await user.type(screen.getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });

  it.each([
    ["restarted", /Windows restarted/],
    ["expired", /7 days/],
    ["helloUnavailable", /isn't available right now/],
  ])("shows only the password when a rule requires it (%s)", async (passwordRequired, note) => {
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => ({ ...HELLO_READY, passwordRequired }) },
    });
    const input = await screen.findByLabelText("Master password");
    expect(await screen.findByText(note)).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(note);
    expect(screen.queryByRole("button", { name: /Windows Hello/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "quick_unlock_unlock")).toBe(false);
  });

  it("warns that Windows Hello is disabled after three attempts", async () => {
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => ({ ...HELLO_READY, passwordRequired: "tooManyAttempts" }) },
    });
    const input = await screen.findByLabelText("Master password");
    expect(screen.getByRole("status")).toHaveTextContent(HELLO_DISABLED);
    expect(screen.queryByText(/didn't go through|3 times in a row/)).not.toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(HELLO_DISABLED);
    expect(screen.queryByRole("button", { name: /Windows Hello/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "quick_unlock_unlock")).toBe(false);
  });

  it("switches to the password when Rust says it is needed after all", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: {
        quick_unlock_status: () => HELLO_READY,
        quick_unlock_unlock: () => {
          throw {
            code: "quick_unlock_password_required",
            message: "Enter your master password to unlock this vault.",
          };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Unlock with Windows Hello" }));
    expect(await screen.findByText("Enter your master password to unlock this vault.")).toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock with Windows Hello" })).not.toBeInTheDocument();
  });

  it("drops the Hello failure text once three attempts require the password", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: {
        quick_unlock_status: () =>
          attempts === 0 ? HELLO_READY : { ...HELLO_READY, passwordRequired: "tooManyAttempts" },
        quick_unlock_unlock: () => {
          attempts += 1;
          throw {
            code: "quick_unlock_failed",
            message: "Windows Hello couldn't confirm it's you. Enter your master password instead.",
          };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Unlock with Windows Hello" }));
    expect(await screen.findByRole("status")).toHaveTextContent(HELLO_DISABLED);
    expect(screen.queryByText(/couldn't confirm|didn't go through/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
  });

  it("doesn't ask for Windows Hello when the window comes to the front", async () => {
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => HELLO_READY, quick_unlock_unlock: () => TEST_VAULT },
    });
    await screen.findByRole("button", { name: "Unlock with Windows Hello" });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls.some((c) => c.cmd === "quick_unlock_unlock")).toBe(false);
    expect(screen.getByRole("button", { name: "Unlock with Windows Hello" })).toBeEnabled();
  });

  it("offers Windows Hello again from the password form", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => HELLO_READY },
    });
    await user.click(await screen.findByRole("button", { name: "Use master password" }));
    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Windows Hello" }));
    expect(screen.getByRole("button", { name: "Unlock with Windows Hello" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: { quick_unlock_status: () => HELLO_READY },
    });
    await screen.findByRole("button", { name: "Unlock with Windows Hello" });
    expect(await axeViolations(container)).toEqual([]);
  });
});

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
    await user.type(await screen.findByLabelText("Master password"), "orbit lantern cactus mosaic");
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
