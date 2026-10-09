import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { PAGE_PATHS } from "@/app/nav";
import { recent, renderApp } from "@/test/render";
import type { BackupStatus, BackupSummary, DashboardSummary, IdentityRef } from "@/ipc/client";
import { formatSize, restoredName } from "./labels";

const FOLDER = "E:\\Backups";
const FILE: BackupSummary = {
  path: `${FOLDER}\\Main-20261005-140300.vaultair-backup`,
  fileName: "Main-20261005-140300.vaultair-backup",
  createdAt: "2026-10-05T14:03:00Z",
  sizeBytes: 2_516_582,
};

function status(over: Partial<BackupStatus> = {}): BackupStatus {
  return {
    destination: null,
    destinationAvailable: false,
    cloudProvider: null,
    lastBackupAt: null,
    lastBackupPath: null,
    lastOutcome: null,
    lastAttemptAt: null,
    reminderDue: true,
    reminderAfterDays: 30,
    ...over,
  };
}

const READY = status({ destination: FOLDER, destinationAvailable: true });
const DONE = status({
  destination: FOLDER,
  destinationAvailable: true,
  lastBackupAt: FILE.createdAt,
  lastBackupPath: FILE.path,
  lastOutcome: "ok",
  lastAttemptAt: FILE.createdAt,
  reminderDue: false,
});

describe("backup settings", () => {
  it("asks for a folder before it can back up", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: {
        backup_status: () => status(),
        vault_pick_folder: () => FOLDER,
        backup_set_destination: () => READY,
      },
    });

    expect(await screen.findByTestId("backup-folder")).toHaveTextContent("No folder chosen");
    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
    expect(screen.getByText("This vault has no backup yet.", { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("last-backup")).toHaveTextContent("None yet");

    await user.click(screen.getByRole("button", { name: "Choose a folder" }));
    expect(await screen.findByText(FOLDER)).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "vault_pick_folder", args: { purpose: "backupDestination" } });
    expect(calls).toContainEqual({ cmd: "backup_set_destination", args: { path: FOLDER } });
    expect(screen.getByRole("button", { name: "Back up now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Change folder" })).toBeInTheDocument();
  });

  it("explains a folder inside the vault", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", {
      handlers: {
        backup_status: () => status(),
        vault_pick_folder: () => "C:\\Vaults\\Main\\backups",
        backup_set_destination: () => {
          throw { code: "invalid_input", message: "Some of the details entered aren't valid.", field: "destination" };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Choose a folder" }));
    expect(await screen.findByText(/outside this vault's own folder/)).toBeInTheDocument();
  });

  it("backs up, then shows when", async () => {
    const user = userEvent.setup();
    let made = false;
    const { calls } = await renderApp("/settings", {
      handlers: {
        backup_status: () => (made ? DONE : READY),
        backup_create: () => {
          made = true;
          return FILE;
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(await screen.findByText("Backup saved and checked")).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "backup_create")).toHaveLength(1);
    expect(await screen.findByText(FILE.path)).toBeInTheDocument();
    expect(screen.getByTestId("last-backup")).not.toHaveTextContent("None yet");
    expect(screen.queryByText("Backup due.")).not.toBeInTheDocument();
  });

  it("says so when a backup can't be written, and remembers it", async () => {
    const user = userEvent.setup();
    const message = "Vaultair couldn't write to the backup folder. Check that it exists and the drive is connected.";
    let failed = false;
    await renderApp("/settings", {
      handlers: {
        backup_status: () =>
          failed
            ? status({ destination: FOLDER, lastOutcome: "failed", lastAttemptAt: "2026-10-05T14:03:00Z" })
            : READY,
        backup_create: () => {
          failed = true;
          throw { code: "backup_destination", message };
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(await screen.findByText(/This folder can't be found/)).toBeInTheDocument();
  });

  it("shows a failed last attempt after reopening settings", async () => {
    await renderApp("/settings", {
      handlers: {
        backup_status: () => status({ ...READY, lastOutcome: "failed", lastAttemptAt: "2026-10-05T14:03:00Z" }),
      },
    });
    expect(await screen.findByText(/The last attempt, on .* failed\./)).toBeInTheDocument();
  });

  it("warns about a cloud-synced folder", async () => {
    await renderApp("/settings", {
      handlers: { backup_status: () => status({ ...READY, cloudProvider: "oneDrive" }) },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This folder is synced by OneDrive");
  });

  it("checks a backup file", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: { backup_status: () => DONE, backup_pick_file: () => FILE, backup_verify: () => FILE },
    });
    await user.click(await screen.findByRole("button", { name: "Check a backup" }));
    expect(await screen.findByText(/Main-20261005-140300\.vaultair-backup is intact/)).toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "backup_verify", args: { path: FILE.path } });
  });

  it("reports a backup that fails its check", async () => {
    const user = userEvent.setup();
    const message = "That file isn't a Vaultair backup, or it has been damaged.";
    await renderApp("/settings", {
      handlers: {
        backup_status: () => DONE,
        backup_pick_file: () => FILE,
        backup_verify: () => {
          throw { code: "invalid_backup", message };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Check a backup" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/is intact/)).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/settings", {
      handlers: { backup_status: () => status({ ...DONE, cloudProvider: "dropbox", reminderDue: true }) },
    });
    await screen.findByTestId("backup-folder");
    expect(await axeViolations(container)).toEqual([]);
  });
});

const VAULTS = "C:\\Users\\sam\\AppData\\Local\\Vaultair\\Vaults";

function restoreHandlers(extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return {
    backup_pick_file: () => FILE,
    vault_location_check: (args: Record<string, unknown>) => {
      const parentDir = typeof args.location === "string" ? args.location : VAULTS;
      return {
        parentDir,
        vaultDir: `${parentDir}\\${String(args.name)}`,
        cloudProvider: null,
        alreadyExists: args.name === "Main",
      };
    },
    backup_restore_to: (args: Record<string, unknown>) => {
      const request = args.request as { name: string };
      return { path: `${VAULTS}\\${request.name}` };
    },
    ...extra,
  };
}

describe("restoring a backup", () => {
  it("restores from the lock screen and offers the new vault", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: restoreHandlers(),
    });

    await user.click(await screen.findByRole("button", { name: "Restore a backup" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore a backup" });
    const restore = within(dialog).getByRole("button", { name: "Restore" });
    expect(restore).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Choose a backup file" }));
    expect(await within(dialog).findByText(FILE.fileName)).toBeInTheDocument();
    const name = within(dialog).getByLabelText("Name for the restored vault");
    expect(name).toHaveValue("Main restored");
    expect(await within(dialog).findByText(`${VAULTS}\\Main restored`)).toBeInTheDocument();

    // A name that's taken blocks the restore.
    await user.clear(name);
    await user.type(name, "Main");
    expect(await within(dialog).findByText(/already has files in it/)).toBeInTheDocument();
    expect(restore).toBeDisabled();
    await user.type(name, " copy");
    expect(await within(dialog).findByText(`${VAULTS}\\Main copy`)).toBeInTheDocument();

    await user.click(restore);
    expect(await within(dialog).findByText("Enter the master password this backup was made with.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(restore);

    const done = await screen.findByRole("dialog", { name: "Backup restored" });
    expect(calls.find((c) => c.cmd === "backup_restore_to")?.args).toEqual({
      request: {
        backupPath: FILE.path,
        location: null,
        name: "Main copy",
        password: "orbit lantern cactus mosaic",
      },
    });
    expect(within(done).getByText(`${VAULTS}\\Main copy`)).toBeInTheDocument();

    await user.click(within(done).getByRole("button", { name: "Open the restored vault" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Main copy" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open on a wrong password", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: restoreHandlers({
        backup_restore_to: () => {
          throw { code: "wrong_password", message: "Incorrect master password." };
        },
      }),
    });

    await user.click(await screen.findByRole("button", { name: "Restore a backup" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore a backup" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a backup file" }));
    await within(dialog).findByText(`${VAULTS}\\Main restored`);
    const password = within(dialog).getByLabelText("Master password");
    await user.type(password, "not it at all");
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    expect(await within(dialog).findByText("Incorrect master password.")).toBeInTheDocument();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("dialog", { name: "Backup restored" })).not.toBeInTheDocument();
  });

  it("rejects a file that isn't a backup", async () => {
    const user = userEvent.setup();
    const message = "That file isn't a Vaultair backup, or it has been damaged.";
    await renderApp("/", {
      unlocked: false,
      recents: [recent("Main")],
      handlers: restoreHandlers({
        backup_pick_file: () => {
          throw { code: "invalid_backup", message };
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Restore a backup" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore a backup" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a backup file" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("opens from settings and leaves the open vault alone", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", { handlers: restoreHandlers({ backup_status: () => DONE }) });

    await user.click(await screen.findByRole("button", { name: "Restore a backup" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore a backup" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a backup file" }));
    await within(dialog).findByText(`${VAULTS}\\Main restored`);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(within(dialog).getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));
    const done = await screen.findByRole("dialog", { name: "Backup restored" });
    expect(within(done).getByText(/This vault wasn't changed/)).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });
});

describe("backup reminder", () => {
  const summary: DashboardSummary = {
    identityId: null,
    totalAccounts: 3,
    mainAccounts: 1,
    altAccounts: 2,
    identities: 0,
    missingMfa: 0,
    favorites: 0,
    recent: [],
    weak: 0,
    reused: 0,
    missingRecoveryCodes: 0,
    dormant: 0,
    needsAttention: [],
    accountsCreatedAt: [],
  };
  const dashboard = { dashboard_summary: () => summary, identity_refs: () => [] as IdentityRef[] };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The elements the app scrolled into view, in order. */
  function scrolledTo() {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    return () => spy.mock.contexts as Element[];
  }

  it("shows on the dashboard while a backup is due", async () => {
    await renderApp("/", {
      handlers: { ...dashboard, backup_status: () => status({ ...DONE, reminderDue: true }) },
    });
    const reminder = await screen.findByRole("status");
    expect(reminder).toHaveTextContent("Backup due.");
    expect(reminder).toHaveTextContent("The last backup was made on");
    expect(within(reminder).getByRole("link", { name: "Back up" })).toHaveAttribute(
      "href",
      "/settings#backup-heading",
    );
  });

  it("opens Settings scrolled to Backups", async () => {
    const user = userEvent.setup();
    const scrolled = scrolledTo();
    const { router } = await renderApp("/", {
      handlers: { ...dashboard, backup_status: () => status({ ...DONE, reminderDue: true }) },
    });
    await user.click(within(await screen.findByRole("status")).getByRole("link", { name: "Back up" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "Backups" });
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(router.state.location.hash).toBe("backup-heading");
    await vi.waitFor(() => {
      expect(scrolled()).toContain(heading);
    });
  });

  it("opens Settings scrolled to Backups from the status strip", async () => {
    const user = userEvent.setup();
    const scrolled = scrolledTo();
    await renderApp("/", { handlers: { ...dashboard, backup_status: () => DONE } });
    await user.click(await screen.findByRole("link", { name: "Backup settings" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "Backups" });
    await vi.waitFor(() => {
      expect(scrolled()).toContain(heading);
    });
  });

  it("scrolls to Backups when Settings is already open", async () => {
    const scrolled = scrolledTo();
    const { router } = await renderApp("/settings", { handlers: { backup_status: () => DONE } });
    const heading = await screen.findByRole("heading", { level: 2, name: "Backups" });
    expect(scrolled()).not.toContain(heading);

    await router.navigate({ to: PAGE_PATHS.settings, hash: "backup-heading" });
    await vi.waitFor(() => {
      expect(scrolled()).toContain(heading);
    });
  });

  it("stays away after a recent backup", async () => {
    await renderApp("/", { handlers: { ...dashboard, backup_status: () => DONE } });
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    await screen.findByText("Protected by MFA");
    expect(screen.queryByText("Backup due.")).not.toBeInTheDocument();
  });
});

describe("backup labels", () => {
  it("suggests a name from the backup's file name", () => {
    expect(restoredName("Main vault-20261005-140300.vaultair-backup")).toBe("Main vault restored");
    expect(restoredName("Alts-20261005-140300-2.vaultair-backup")).toBe("Alts restored");
    expect(restoredName("renamed.vaultair-backup")).toBe("renamed restored");
  });

  it("formats sizes", () => {
    expect(formatSize(300)).toBe("1 KB");
    expect(formatSize(812 * 1024)).toBe("812 KB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
