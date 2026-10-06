import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SESSION_CONFIG, DEFAULT_VAULT_SETTINGS, TEST_VAULT, renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";

const STRONG = { score: 4, longEnough: true, meetsPolicy: true, warning: null, suggestions: [] };
const KDF = { mKib: 65536, t: 3, p: 4 };

function savedCalls(calls: { cmd: string; args: Record<string, unknown> }[]) {
  return calls.filter((c) => c.cmd === "settings_update").map((c) => c.args.settings);
}

describe("lock and clipboard settings", () => {
  it("saves each change as a whole settings object", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: { settings_update: () => DEFAULT_SESSION_CONFIG },
    });

    const autoLock = await screen.findByLabelText("Lock after inactivity");
    expect(autoLock).toHaveValue("5");
    await user.selectOptions(autoLock, "30");
    expect(savedCalls(calls)).toContainEqual({ ...DEFAULT_VAULT_SETTINGS, autoLockMinutes: 30 });

    await user.selectOptions(screen.getByLabelText("Clear copied values after"), "90");
    expect(savedCalls(calls)).toContainEqual({
      ...DEFAULT_VAULT_SETTINGS,
      autoLockMinutes: 30,
      clipboardClearSecs: 90,
    });

    await user.click(screen.getByRole("switch", { name: "Lock when minimized" }));
    expect(savedCalls(calls).at(-1)).toEqual(expect.objectContaining({ lockOnMinimize: true }));
  });

  it("asks before turning auto-lock off", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: { settings_update: () => ({ ...DEFAULT_SESSION_CONFIG, idleLockSecs: null }) },
    });
    const autoLock = await screen.findByLabelText("Lock after inactivity");

    await user.selectOptions(autoLock, "never");
    const dialog = await screen.findByRole("dialog", { name: "Never lock after inactivity?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep auto-lock" }));
    expect(savedCalls(calls)).toEqual([]);
    expect(autoLock).toHaveValue("5");

    await user.selectOptions(autoLock, "never");
    await user.click(await screen.findByRole("button", { name: "Never lock on its own" }));
    expect(savedCalls(calls)).toEqual([{ ...DEFAULT_VAULT_SETTINGS, autoLockMinutes: null }]);
    expect(autoLock).toHaveValue("never");
    expect(autoLock).toHaveAccessibleDescription(/Never locks on its own/);
  });

  it("keeps a saved value that isn't one of the choices", async () => {
    await renderApp("/settings", {
      handlers: { settings_get: () => ({ ...DEFAULT_VAULT_SETTINGS, autoLockMinutes: 7 }) },
    });
    expect(await screen.findByLabelText("Lock after inactivity")).toHaveValue("7");
    expect(screen.getByRole("option", { name: "7 minutes" })).toBeInTheDocument();
  });
});

describe("change master password", () => {
  it("refuses a mismatch, reports a wrong current password, then changes it", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = await renderApp("/settings", {
      handlers: {
        strength_estimate: () => STRONG,
        vault_change_password: () => {
          attempts += 1;
          if (attempts === 1) throw { code: "wrong_password", message: "Incorrect master password." };
          return TEST_VAULT;
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Change master password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change master password" });
    expect(within(dialog).getByText(/Old backups keep the old password/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Current master password"), "orbit lantern cactus mosaic");
    await user.type(within(dialog).getByLabelText("New master password"), "velvet harbor quartz meadow");
    await user.type(within(dialog).getByLabelText("Confirm new master password"), "velvet harbor quartz");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("The two entries don't match.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "vault_change_password")).toBe(false);

    await user.type(within(dialog).getByLabelText("Confirm new master password"), " meadow");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Incorrect master password.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Current master password")).toHaveAttribute("aria-invalid", "true");

    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      cmd: "vault_change_password",
      args: { current: "orbit lantern cactus mosaic", newPassword: "velvet harbor quartz meadow" },
    });
  });

  it("refuses the same password again", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", { handlers: { strength_estimate: () => STRONG } });
    await user.click(await screen.findByRole("button", { name: "Change master password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change master password" });
    for (const label of ["Current master password", "New master password", "Confirm new master password"]) {
      await user.type(within(dialog).getByLabelText(label), "orbit lantern cactus mosaic");
    }
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Choose a password different from the current one.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "vault_change_password")).toBe(false);
  });

  it("has no axe violations", async () => {
    const user = userEvent.setup();
    await renderApp("/settings");
    await user.click(await screen.findByRole("button", { name: "Change master password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change master password" });
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe("strengthen key derivation", () => {
  it("says so when this PC can't do better", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", {
      handlers: {
        vault_kdf_check: () => ({
          current: KDF,
          currentSummary: "Argon2id 64 MiB, t=3, p=4",
          suggested: KDF,
          suggestedSummary: "Argon2id 64 MiB, t=3, p=4",
          canStrengthen: false,
        }),
      },
    });
    expect(await screen.findByTestId("kdf-summary")).toHaveTextContent(TEST_VAULT.kdfSummary);
    await user.click(screen.getByRole("button", { name: "Strengthen key derivation" }));
    expect(await screen.findByText(/Already as strong as this PC/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("re-wraps with the measured parameters and the same password", async () => {
    const user = userEvent.setup();
    const stronger = { mKib: 524288, t: 3, p: 4 };
    const { calls } = await renderApp("/settings", {
      handlers: {
        vault_kdf_check: () => ({
          current: KDF,
          currentSummary: "Argon2id 64 MiB, t=3, p=4",
          suggested: stronger,
          suggestedSummary: "Argon2id 512 MiB, t=3, p=4",
          canStrengthen: true,
        }),
        vault_strengthen_kdf: () => ({ ...TEST_VAULT, kdfSummary: "Argon2id 512 MiB, t=3, p=4" }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Strengthen key derivation" }));
    const dialog = await screen.findByRole("dialog", { name: "Strengthen key derivation" });
    expect(within(dialog).getByTestId("kdf-suggested")).toHaveTextContent("512 MiB");

    await user.click(within(dialog).getByRole("button", { name: "Strengthen" }));
    expect(await within(dialog).findByText("Enter your master password.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(within(dialog).getByRole("button", { name: "Strengthen" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      cmd: "vault_strengthen_kdf",
      args: { password: "orbit lantern cactus mosaic", kdf: stronger },
    });
    expect(screen.getByTestId("kdf-summary")).toHaveTextContent("512 MiB");
  });
});

describe("general settings", () => {
  it("renames the vault and shows it in the sidebar", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: {
        vault_profile_update: (args) => ({ ...TEST_VAULT, ...(args.input as object) }),
      },
    });
    const name = await screen.findByLabelText("Vault name");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.clear(name);
    await user.type(name, "con");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Windows reserves this name. Choose another.")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "vault_profile_update")).toBe(false);

    await user.clear(name);
    await user.type(name, "Tournament");
    await user.click(screen.getByRole("radio", { name: "Teal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toContainEqual({
      cmd: "vault_profile_update",
      args: { input: { name: "Tournament", color: "teal" } },
    });
    const sidebar = screen.getByRole("navigation", { name: "Main" }).closest("aside");
    expect(await within(sidebar as HTMLElement).findByText("Tournament")).toBeInTheDocument();
  });
});

describe("privacy and about", () => {
  it("shows the logs folder and opens it", async () => {
    const user = userEvent.setup();
    const folder = "C:\\Users\\sam\\AppData\\Local\\Vaultair\\logs";
    const { calls } = await renderApp("/settings", { handlers: { logs_folder: () => folder } });
    expect(await screen.findByTestId("logs-folder")).toHaveTextContent(folder);
    expect(screen.getByTestId("privacy-promises")).toHaveTextContent("No network.");
    await user.click(screen.getByRole("button", { name: "Open logs folder" }));
    expect(calls.some((c) => c.cmd === "logs_open")).toBe(true);
  });

  it("credits the EFF wordlist", async () => {
    await renderApp("/settings");
    expect(await screen.findByTestId("credits")).toHaveTextContent(/EFF large wordlist.*CC BY 3\.0 US/);
    expect(await screen.findByTestId("app-version")).toHaveTextContent("Vaultair 0.1.0");
  });
});
