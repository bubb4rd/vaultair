import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { renderApp, TEST_VAULT, type RenderOptions } from "@/test/render";

const STRONG = "orbit lantern cactus mosaic";
const DEFAULT_DIR = "C:\\Users\\sam\\AppData\\Local\\Vaultair\\Vaults";

/** Stand-in for the Rust scorer: long passphrases with spaces pass. */
function estimate({ password }: Record<string, unknown>) {
  const pw = String(password);
  const longEnough = Array.from(pw).length >= 12;
  const score = longEnough && pw.includes(" ") ? 4 : 1;
  return { score, longEnough, meetsPolicy: longEnough && score >= 3, warning: null, suggestions: [] };
}

const locationCheck =
  (cloudProvider: string | null = null) =>
  (args: Record<string, unknown>) => {
    const parentDir = typeof args.location === "string" ? args.location : DEFAULT_DIR;
    return { parentDir, vaultDir: `${parentDir}\\${String(args.name)}`, cloudProvider, alreadyExists: false };
  };

function renderOnboarding(handlers: RenderOptions["handlers"] = {}) {
  return renderApp("/", {
    unlocked: false,
    handlers: {
      strength_estimate: estimate,
      vault_location_check: locationCheck(),
      vault_kdf_calibrate: () => ({ mKib: 262144, t: 3, p: 4 }),
      vault_create: () => TEST_VAULT,
      ...handlers,
    },
  });
}

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const click = (user: UserEvent, name: string | RegExp) => user.click(screen.getByRole("button", { name }));

async function toLocation(user: UserEvent) {
  await heading("Set up your vault");
  await click(user, "Get started");
  await heading("Everything stays on this PC");
  await click(user, "Continue");
  await heading(/can't recover your master password/);
  await user.click(screen.getByRole("checkbox"));
  await click(user, "Continue");
  await heading("Name your vault");
  await click(user, "Continue");
  await heading("Choose where to keep it");
  await waitFor(() => {
    expect(screen.getByTestId("vault-dir")).toHaveTextContent("My vault");
  });
}

async function toPassword(user: UserEvent) {
  await toLocation(user);
  await click(user, "Continue");
  await heading("Create your master password");
}

describe("onboarding", () => {
  it("is shown when no vault is known, with a horizontal progress bar and no sidebar", async () => {
    await renderOnboarding();
    const title = await heading("Set up your vault");
    const progress = screen.getByRole("navigation", { name: "Setup progress" });
    const stages = within(progress).getAllByRole("listitem");
    expect(stages.map((li) => li.textContent)).toEqual([
      "Welcome",
      "Your vault",
      "Master password",
      "Create",
      "Next steps",
    ]);
    expect(stages[0]).toHaveAttribute("aria-current", "step");
    // The progress sits above the step, and there is no side navigation.
    expect(progress.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("advances the progress as you move through the stages", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await toPassword(user);
    const stages = within(screen.getByRole("navigation", { name: "Setup progress" })).getAllByRole("listitem");
    expect(stages[2]).toHaveAttribute("aria-current", "step");
    expect(stages[0]).toHaveTextContent("Welcome (done)");
    expect(stages[1]).toHaveTextContent("Your vault (done)");
  });

  it("requires acknowledging that the master password can't be recovered", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await heading("Set up your vault");
    await click(user, "Get started");
    await click(user, "Continue");
    await heading(/can't recover/);
    await click(user, "Continue");
    expect(await screen.findByText("Tick the box to continue.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/can't recover/);
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("animates forward steps in from the right and Back from the left", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    const screenOf = (title: HTMLElement) => title.closest("[data-direction]");
    await heading("Set up your vault");
    await click(user, "Get started");
    expect(screenOf(await heading("Everything stays on this PC"))).toHaveAttribute("data-direction", "forward");
    expect(screenOf(await heading("Everything stays on this PC"))).toHaveClass("animate-in", "slide-in-from-right-6");
    await click(user, "Back");
    expect(screenOf(await heading("Set up your vault"))).toHaveAttribute("data-direction", "back");
    expect(screenOf(await heading("Set up your vault"))).toHaveClass("slide-in-from-left-6");
  });

  it("styles the no-recovery acknowledgement as a danger", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await heading("Set up your vault");
    await click(user, "Get started");
    await click(user, "Continue");
    await heading(/can't recover/);
    const checkbox = screen.getByRole("checkbox", {
      name: /no way to recover a forgotten master password.*I understand/,
    });
    expect(checkbox.closest("label")).toHaveClass("border-status-risk/45", "bg-status-risk/8");
  });

  it("rejects an invalid vault name", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await heading("Set up your vault");
    await click(user, "Get started");
    await click(user, "Continue");
    await user.click(await screen.findByRole("checkbox"));
    await click(user, "Continue");
    const name = await screen.findByLabelText("Vault name");
    await user.clear(name);
    await user.type(name, "con");
    await click(user, "Continue");
    expect(await screen.findByText(/Windows reserves this name/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Name your vault");
  });

  it("warns when the folder is synced by OneDrive", async () => {
    const user = userEvent.setup();
    await renderOnboarding({ vault_location_check: locationCheck("oneDrive") });
    await toLocation(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("This folder is synced by OneDrive");
  });

  it("uses a folder chosen in the picker", async () => {
    const user = userEvent.setup();
    const { calls } = await renderOnboarding({ vault_pick_folder: () => "D:\\Vaults" });
    await toLocation(user);
    await click(user, "Choose another folder");
    await waitFor(() => {
      expect(screen.getByTestId("vault-dir")).toHaveTextContent("D:\\Vaults\\My vault");
    });
    expect(calls.find((c) => c.cmd === "vault_pick_folder")?.args).toEqual({ purpose: "newVaultLocation" });
  });

  it("blocks a weak password", async () => {
    const user = userEvent.setup();
    const { calls } = await renderOnboarding();
    await toPassword(user);
    await user.type(screen.getByLabelText("Master password"), "password12345");
    await user.type(screen.getByLabelText("Confirm master password"), "password12345");
    await click(user, "Create vault");
    expect(await screen.findByText(/too easy to guess/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your master password");
    expect(calls.some((c) => c.cmd === "vault_create")).toBe(false);
  });

  it("blocks a short password", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await toPassword(user);
    await user.type(screen.getByLabelText("Master password"), "short one");
    await click(user, "Create vault");
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
  });

  it("blocks mismatched entries", async () => {
    const user = userEvent.setup();
    const { calls } = await renderOnboarding();
    await toPassword(user);
    await user.type(screen.getByLabelText("Master password"), STRONG);
    await user.type(screen.getByLabelText("Confirm master password"), `${STRONG}x`);
    await click(user, "Create vault");
    expect(await screen.findByText("The two entries don't match.")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm master password")).toHaveFocus();
    expect(calls.some((c) => c.cmd === "vault_create")).toBe(false);
  });

  it("password fields opt out of autocomplete and spellcheck", async () => {
    const user = userEvent.setup();
    await renderOnboarding();
    await toPassword(user);
    for (const label of ["Master password", "Confirm master password"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("type", "password");
      expect(input).toHaveAttribute("autocomplete", "off");
      expect(input).toHaveAttribute("spellcheck", "false");
      expect(input).toHaveAttribute("autocorrect", "off");
      expect(input).toHaveAttribute("autocapitalize", "off");
    }
  });

  it("creates the vault and opens the dashboard", async () => {
    const user = userEvent.setup();
    const { calls } = await renderOnboarding();
    await toPassword(user);
    await user.type(screen.getByLabelText("Master password"), STRONG);
    await user.type(screen.getByLabelText("Confirm master password"), STRONG);
    await waitFor(() => {
      expect(screen.getByText("Strong")).toBeInTheDocument();
    });
    await click(user, "Create vault");

    await heading("Your vault is ready");
    const create = calls.filter((c) => c.cmd === "vault_create");
    expect(create).toHaveLength(1);
    expect(create[0]?.args.request).toEqual({
      name: "My vault",
      location: null,
      kdf: { mKib: 262144, t: 3, p: 4 },
      password: STRONG,
    });

    await click(user, "Skip");
    await heading("Plan for backups");
    await click(user, "Open my vault");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    // Nothing on the page still holds the password.
    expect(document.body.innerHTML).not.toContain(STRONG);
  });

  it("creates a demo vault through the same flow", async () => {
    const user = userEvent.setup();
    const { calls } = await renderOnboarding({ vault_create_demo: () => ({ ...TEST_VAULT, demo: true }) });
    await heading("Set up your vault");
    await click(user, "Create a demo vault");
    await click(user, "Continue");
    await user.click(await screen.findByRole("checkbox"));
    await click(user, "Continue");
    expect(await screen.findByLabelText("Vault name")).toHaveValue("Demo vault");
    await click(user, "Continue");
    await waitFor(() => {
      expect(screen.getByTestId("vault-dir")).toHaveTextContent("Demo vault");
    });
    await click(user, "Continue");
    await user.type(await screen.findByLabelText("Master password"), STRONG);
    await user.type(screen.getByLabelText("Confirm master password"), STRONG);
    await click(user, "Create vault");
    await heading("Your vault is ready");
    expect(calls.some((c) => c.cmd === "vault_create_demo")).toBe(true);
    expect(calls.some((c) => c.cmd === "vault_create")).toBe(false);
  });

  it("explains a failed create and offers a way back", async () => {
    const user = userEvent.setup();
    await renderOnboarding({
      vault_create: () => {
        throw {
          code: "vault_exists",
          message: "That folder already contains files. Choose another name or location.",
        };
      },
    });
    await toPassword(user);
    await user.type(screen.getByLabelText("Master password"), STRONG);
    await user.type(screen.getByLabelText("Confirm master password"), STRONG);
    await click(user, "Create vault");
    await heading("Your vault wasn't created");
    expect(screen.getByRole("alert")).toHaveTextContent("already contains files");
    await click(user, "Change details");
    await heading("Choose where to keep it");
  });

  it("has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = await renderOnboarding();
    await toPassword(user);
    expect(await axeViolations(container)).toEqual([]);
  });
});
