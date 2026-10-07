import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SESSION_CONFIG, DEFAULT_VAULT_SETTINGS, TEST_VAULT, renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";

const OFF = { hello: "available", hardwareBacked: true, enabled: false, passwordRequired: null };
const ON = { ...OFF, enabled: true };
const WRONG = { code: "wrong_password", message: "Incorrect master password." };
const PASSWORD = "orbit lantern cactus mosaic";

async function helloSection() {
  const heading = await screen.findByRole("heading", { level: 3, name: "Windows Hello" });
  const section = heading.parentElement;
  if (!section) throw new Error("no Windows Hello section");
  return within(section);
}

describe("Windows Hello unlock", () => {
  it("says how to set Hello up when this PC has none", async () => {
    await renderApp("/settings", {
      handlers: { quick_unlock_status: () => ({ ...OFF, hello: "notSetUp" }) },
    });
    const section = await helloSection();
    expect(section.getByText(/isn't set up on this PC/)).toBeInTheDocument();
    expect(section.queryByRole("button")).not.toBeInTheDocument();
  });

  it("turns on after the master password, and reports a wrong one", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = await renderApp("/settings", {
      handlers: {
        quick_unlock_status: () => OFF,
        quick_unlock_enable: () => {
          attempts += 1;
          if (attempts === 1) throw WRONG;
          return ON;
        },
      },
    });
    const section = await helloSection();
    expect(calls.find((c) => c.cmd === "quick_unlock_status")?.args).toEqual({ path: TEST_VAULT.path });
    await user.click(section.getByRole("button", { name: "Turn on Windows Hello unlock" }));

    const dialog = await screen.findByRole("dialog", { name: "Turn on Windows Hello unlock" });
    expect(within(dialog).getByText(/after Windows restarts, every 7 days/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/has no TPM/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(await within(dialog).findByText("Enter your master password.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "quick_unlock_enable")).toBe(false);

    const input = within(dialog).getByLabelText("Master password");
    await user.type(input, "not the password");
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(await within(dialog).findByText("Incorrect master password.")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(await section.findByText("On for this vault on this PC.")).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "quick_unlock_enable").at(-1)?.args).toEqual({ password: PASSWORD });
    expect(section.getByRole("button", { name: "Forget this device" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("warns before turning on when this PC has no TPM", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", {
      handlers: { quick_unlock_status: () => ({ ...OFF, hardwareBacked: false }) },
    });
    await user.click((await helloSection()).getByRole("button", { name: "Turn on Windows Hello unlock" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on Windows Hello unlock" });
    expect(within(dialog).getByText("This PC has no TPM.")).toBeInTheDocument();
  });

  it("changes nothing when the Windows Hello prompt is cancelled", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", {
      handlers: {
        quick_unlock_status: () => OFF,
        quick_unlock_enable: () => {
          throw { code: "quick_unlock_cancelled", message: "Windows Hello was cancelled." };
        },
      },
    });
    const section = await helloSection();
    await user.click(section.getByRole("button", { name: "Turn on Windows Hello unlock" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on Windows Hello unlock" });
    await user.type(within(dialog).getByLabelText("Master password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(
      await within(dialog).findByText("Windows Hello was cancelled. Nothing was changed."),
    ).toBeInTheDocument();
    expect(section.queryByText("On for this vault on this PC.")).not.toBeInTheDocument();
  });

  it("forgets this device after the master password", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: { quick_unlock_status: () => ON, quick_unlock_forget: () => OFF },
    });
    const section = await helloSection();
    expect(section.getByText("On for this vault on this PC.")).toBeInTheDocument();
    await user.click(section.getByRole("button", { name: "Forget this device" }));

    const dialog = await screen.findByRole("dialog", { name: "Forget this device?" });
    await user.type(within(dialog).getByLabelText("Master password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Forget this device" }));
    expect(await section.findByRole("button", { name: "Turn on Windows Hello unlock" })).toBeInTheDocument();
    expect(calls.find((c) => c.cmd === "quick_unlock_forget")?.args).toEqual({ password: PASSWORD });
  });

  it("asks for the master password before turning auto-lock off", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = await renderApp("/settings", {
      handlers: {
        quick_unlock_status: () => ON,
        settings_update: () => {
          attempts += 1;
          if (attempts === 1) throw WRONG;
          return { ...DEFAULT_SESSION_CONFIG, idleLockSecs: null };
        },
      },
    });
    const autoLock = await screen.findByLabelText("Lock after inactivity");
    await helloSection();
    await user.selectOptions(autoLock, "never");
    const dialog = await screen.findByRole("dialog", { name: "Never lock after inactivity?" });
    const input = within(dialog).getByLabelText("Master password");

    await user.click(within(dialog).getByRole("button", { name: "Never lock on its own" }));
    expect(await within(dialog).findByText("Enter your master password.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "settings_update")).toBe(false);

    await user.type(input, "not the password");
    await user.click(within(dialog).getByRole("button", { name: "Never lock on its own" }));
    expect(await within(dialog).findByText("Incorrect master password.")).toBeInTheDocument();
    expect(autoLock).toHaveValue("5");

    await user.clear(input);
    await user.type(input, PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Never lock on its own" }));
    await waitFor(() => {
      expect(autoLock).toHaveValue("never");
    });
    expect(calls.filter((c) => c.cmd === "settings_update").at(-1)?.args).toEqual({
      settings: { ...DEFAULT_VAULT_SETTINGS, autoLockMinutes: null },
      password: PASSWORD,
    });
  });

  it("says a password change turns Windows Hello unlock off", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", { handlers: { quick_unlock_status: () => ON } });
    await helloSection();
    await user.click(screen.getByRole("button", { name: "Change master password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change master password" });
    expect(within(dialog).getByText(/Windows Hello unlock turns off/)).toBeInTheDocument();
  });

  it("has no axe violations, on or off", async () => {
    for (const status of [OFF, ON]) {
      const { container, unmount } = await renderApp("/settings", {
        handlers: { quick_unlock_status: () => status },
      });
      await helloSection();
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
  });
});

describe("keep running in the tray", () => {
  it("saves the switch for the app", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: { tray_set: () => ({ ...DEFAULT_SESSION_CONFIG, keepInTray: true }) },
    });
    const toggle = await screen.findByRole("switch", { name: "Keep running in the tray" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/locks the vault and keeps Vaultair in the tray/);
    await user.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    expect(calls.find((c) => c.cmd === "tray_set")?.args).toEqual({ enabled: true });
  });
});
