import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountDetail, NotesSuggestions, PurposeView } from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { renderApp, type RenderOptions } from "@/test/render";
import { scanNotes, suggestionLines } from "./notesHints";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

const NONE: NotesSuggestions = { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false };

describe("scanNotes (mirrors notes_hints.rs)", () => {
  it.each([
    ["old login went to owl@example.com.", { identifiers: true }],
    ["Username: nightowl", { identifiers: true }],
    ["gamertag = NightOwl#2231", { identifiers: true }],
    ["Player ID :  12345", { identifiers: true }],
    ["PIN: 4821", { credentials: true }],
    ["pw=hunter2", { credentials: true }],
    ["Backup codes 1234-5678 2345-6789", { backupCodes: true }],
    ["Security question: first pet", { securityAnswers: true }],
    [
      "Email: a@example.com\nPassword: x\nRecovery codes below",
      { identifiers: true, credentials: true, backupCodes: true },
    ],
    ["Changed the password in May; the login page moved.", {}],
    ["Support said @nightowl on the forum", {}],
    ["a@b", {}],
    ["superuser: yes", {}],
    ["passport: in the drawer", {}],
    ["", {}],
  ])("%j", (text, expected) => {
    expect(scanNotes(text)).toEqual({ ...NONE, ...expected });
  });

  it("says what moving each kind of detail changes", () => {
    const lines = suggestionLines({ ...NONE, identifiers: true, credentials: true });
    expect(lines.map((l) => l.key)).toEqual(["identifiers", "credentials"]);
    expect(lines[0]?.text).toMatch(/show without revealing and be searchable/);
    expect(lines[1]?.text).toMatch(/stays just as encrypted/);
  });
});

const PURPOSES: PurposeView[] = [{ id: "builtin-main", slug: "main", name: "Main", isBuiltin: true, isHidden: false, color: null, accountCount: 0 }];

const detail = (suggestions: Partial<NotesSuggestions>): AccountDetail => ({
  id: "a1",
  title: "Old mailbox",
  accountType: "email",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: null,
  email: null,
  recoveryEmail: null,
  recoveryPhone: null,
  hasPassword: false,
  passwordStrength: null,
  passwordChangedAt: null,
  websiteUrl: null,
  loginUrl: null,
  catalogLoginUrl: null,
  platformId: null,
  platformName: null,
  platformIcon: null,
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  region: null,
  playerId: null,
  displayName: null,
  notes: null,
  hasSensitiveNotes: true,
  notesSuggestions: { ...NONE, ...suggestions },
  favorite: false,
  archivedAt: null,
  lastVerifiedAt: null,
  lastUsedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
  // Relative to now, so the account reads as Active whenever the tests run.
  lastActivityAt: new Date().toISOString(),
  tags: [],
  customFields: [],
  mfa: [],
});

function handlers(d: AccountDetail, extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      account_get: () => d,
      account_list: () => [],
      purpose_list: () => PURPOSES,
      tag_list: () => [],
      platform_list: () => [],
      game_list: () => [],
      game_profile_list: () => [],
      ...extra,
    },
  };
}

describe("account page suggestion", () => {
  it("suggests moving details out of the sensitive notes, and can be declined", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn(() => detail({}));
    await renderApp(
      "/accounts/a1",
      handlers(detail({ identifiers: true, backupCodes: true }), { account_dismiss_notes_suggestions: dismiss }),
    );
    const panel = await screen.findByRole("region", {
      name: "Your sensitive notes may hold details that have their own field",
    });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).getByRole("link", { name: "Edit account" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Keep in notes" }));
    await waitFor(() => {
      expect(dismiss).toHaveBeenCalledWith({ id: "a1" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /may hold details/ })).not.toBeInTheDocument();
    });
  });

  it("shows nothing when there's nothing to suggest", async () => {
    await renderApp("/accounts/a1", handlers(detail({})));
    await screen.findByRole("heading", { name: "Notes" });
    expect(screen.queryByRole("region", { name: /may hold details/ })).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/accounts/a1", handlers(detail({ credentials: true })));
    await screen.findByRole("region", { name: /may hold details/ });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("account form hint", () => {
  it("hints while typing sensitive notes that hold account details", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts/new", handlers(detail({})));
    const notes = await screen.findByLabelText("Sensitive notes");
    expect(screen.queryByText("Some of this may belong in its own field")).not.toBeInTheDocument();
    await user.type(notes, "Username: nightowl");
    expect(await screen.findByText("Some of this may belong in its own field")).toBeInTheDocument();
    expect(screen.getByText(/put it in Email, Username or Recovery email/)).toBeInTheDocument();
  });

  it("offers the provider as the platform of an email account", async () => {
    const user = userEvent.setup();
    await renderApp(
      "/accounts/new",
      handlers(detail({}), {
        platform_list: () => [
          {
            id: "builtin-pl-gmail",
            name: "Gmail",
            kind: "email",
            publisher: "Google",
            defaultLoginUrl: "https://mail.google.com/",
            icon: "gmail",
            isBuiltin: true,
            accountCount: 0,
            profileCount: 0,
          },
        ],
      }),
    );
    await user.selectOptions(await screen.findByLabelText("Type"), "Email");
    await user.type(screen.getByLabelText("Email"), "owl@gmail.com");
    await user.click(await screen.findByRole("button", { name: "Set the platform to Gmail" }));
    expect(screen.getByLabelText<HTMLSelectElement>("Platform").value).toBe("builtin-pl-gmail");
  });
});
