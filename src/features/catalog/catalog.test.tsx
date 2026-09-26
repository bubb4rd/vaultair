import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountDetail, AccountSummary, GameProfileView, GameView, PlatformView, PurposeView } from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { renderApp, type RenderOptions } from "@/test/render";
import { accountMark } from "./CatalogLogo";
import { EMAIL_PROVIDER_ENTRIES, LOGO_SLUGS, emailProvider, logoColor, monogram } from "./logos";

vi.mock("@/lib/webview", () => ({ reloadWebview: vi.fn() }));

const PURPOSES: PurposeView[] = [{ id: "builtin-main", slug: "main", name: "Main", isBuiltin: true }];

const platform = (over: Partial<PlatformView>): PlatformView => ({
  id: "builtin-pl-steam",
  name: "Steam",
  kind: "launcher",
  publisher: "Valve",
  defaultLoginUrl: "https://store.steampowered.com/login/",
  icon: "steam",
  isBuiltin: true,
  accountCount: 0,
  profileCount: 0,
  ...over,
});

const game = (over: Partial<GameView>): GameView => ({
  id: "builtin-game-valorant",
  name: "Valorant",
  franchise: null,
  publisher: "Riot Games",
  icon: "valorant",
  isBuiltin: true,
  accountCount: 0,
  profileCount: 0,
  ...over,
});

const summary = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "a1",
  title: "Game store (main)",
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: null,
  platformId: null,
  platformName: null,
  platformIcon: null,
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  hasPassword: true,
  passwordStrength: 4,
  mfaEnabled: true,
  backupCodesRemaining: 0,
  favorite: false,
  favoritedAt: null,
  archivedAt: null,
  tags: [],
  updatedAt: "2026-09-20T10:00:00Z",
  // Relative to now, so the account reads as Active whenever the tests run.
  lastActivityAt: new Date().toISOString(),
  ...over,
});

const STEAM_ACCOUNT = summary({
  platformId: "builtin-pl-steam",
  platformName: "Steam",
  platformIcon: "steam",
});
const XBOX_ACCOUNT = summary({
  id: "a2",
  title: "Console",
  accountType: "console",
  platformId: "builtin-pl-xbox",
  platformName: "Xbox",
  platformIcon: null,
});
const PLAIN_ACCOUNT = summary({ id: "a3", title: "Old launcher" });

const PROFILE: GameProfileView = {
  id: "p1",
  accountId: "a1",
  accountTitle: "Game store (main)",
  gameId: "builtin-game-valorant",
  gameName: "Valorant",
  gameIcon: "valorant",
  platformId: "builtin-pl-steam",
  platformName: "Steam",
  gamertag: "NightOwl#EUW",
  playerId: null,
  region: "EU",
  rankTier: "Diamond 2",
  currentSeason: null,
  notes: null,
  linkedLauncherAccountId: null,
  linkedLauncherTitle: null,
  linkedConsoleAccountId: null,
  linkedConsoleTitle: null,
  updatedAt: "2026-09-20T10:00:00Z",
};

const DETAIL: AccountDetail = {
  id: "a1",
  title: "Game store (main)",
  accountType: "launcher",
  purposeId: "builtin-main",
  purposeName: "Main",
  status: "active",
  identityId: null,
  identityName: null,
  username: "nightowl",
  email: null,
  recoveryEmail: null,
  recoveryPhone: null,
  hasPassword: false,
  passwordStrength: null,
  passwordChangedAt: null,
  websiteUrl: null,
  loginUrl: null,
  catalogLoginUrl: "https://store.steampowered.com/login/",
  platformId: "builtin-pl-steam",
  platformName: "Steam",
  platformIcon: "steam",
  gameId: null,
  gameName: null,
  gameIcon: null,
  publisher: null,
  region: null,
  playerId: null,
  displayName: null,
  notes: null,
  hasSensitiveNotes: false,
  notesSuggestions: { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false },
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
};

const PLATFORMS = [
  platform({ accountCount: 1, profileCount: 1 }),
  platform({
    id: "builtin-pl-xbox",
    name: "Xbox",
    kind: "console",
    icon: null,
    accountCount: 1,
  }),
  platform({
    id: "builtin-pl-discord",
    name: "Discord",
    kind: "social",
    icon: "discord",
  }),
];
const GAMES = [
  game({ profileCount: 1 }),
  game({
    id: "builtin-game-lol",
    name: "League of Legends",
    icon: "leagueoflegends",
  }),
];

function handlers(extra: RenderOptions["handlers"] = {}): RenderOptions {
  return {
    handlers: {
      account_list: (a) => {
        if (a.archived) return [];
        const f = a.filter as { platformId: string | null } | undefined;
        const all = [STEAM_ACCOUNT, XBOX_ACCOUNT, PLAIN_ACCOUNT];
        return f?.platformId ? all.filter((x) => x.platformId === f.platformId) : all;
      },
      account_get: () => DETAIL,
      platform_list: () => PLATFORMS,
      game_list: () => GAMES,
      game_profile_list: () => [PROFILE],
      purpose_list: () => PURPOSES,
      tag_list: () => [],
      ...extra,
    },
  };
}

describe("logos", () => {
  it("bundles a logo for every icon the built-in catalog names", () => {
    const files = import.meta.glob<{
      platforms: { icon: string | null }[];
      games: { icon: string | null }[];
    }>("/crates/vaultair-core/catalog/default_catalog.json", {
      eager: true,
      import: "default",
    });
    const json = Object.values(files)[0];
    expect(json).toBeDefined();
    const icons = [...(json?.platforms ?? []), ...(json?.games ?? [])].map((e) => e.icon).filter(Boolean);
    expect(icons.length).toBeGreaterThan(10);
    for (const icon of icons) expect(LOGO_SLUGS).toContain(icon);
  });

  it("keeps brand colours only where they stay visible on the dark UI", () => {
    expect(logoColor("000000")).toBeNull();
    expect(logoColor("313131")).toBeNull();
    expect(logoColor("5865F2")).toBe("#5865F2");
    expect(logoColor("EB0029")).toBe("#EB0029");
  });

  it("makes initials for the placeholder", () => {
    expect(monogram("Nintendo Account")).toBe("NA");
    expect(monogram("Xbox")).toBe("X");
    expect(monogram("osu!")).toBe("O");
    expect(monogram("Outlook.com")).toBe("OC");
    expect(monogram("!!!")).toBe("?");
  });

  it("marks a game account by its game and other accounts by their platform", () => {
    const both = {
      title: "Ranked",
      email: null,
      publisher: null,
      platformName: "Riot Games",
      platformIcon: "riotgames",
      gameName: "Valorant",
      gameIcon: "valorant",
    };
    expect(accountMark({ ...both, accountType: "game" }).icon).toBe("valorant");
    expect(accountMark({ ...both, accountType: "launcher" }).icon).toBe("riotgames");
    // A logo beats a monogram: the platform has one, the game doesn't.
    expect(accountMark({ ...both, accountType: "game", gameIcon: null }).icon).toBe("riotgames");
    expect(
      accountMark({
        ...both,
        accountType: "launcher",
        platformName: null,
        gameName: null,
        publisher: "Example",
      }),
    ).toEqual({ icon: null, name: "Example" });
  });
});

describe("email providers", () => {
  const files = import.meta.glob<{ platforms: { id: string; icon: string | null; kind: string }[] }>(
    "/crates/vaultair-core/catalog/default_catalog.json",
    { eager: true, import: "default" },
  );
  const platforms = Object.values(files)[0]?.platforms ?? [];

  it("point at built-in email platforms with the same logo", () => {
    for (const { platformId, icon } of EMAIL_PROVIDER_ENTRIES) {
      const entry = platforms.find((p) => p.id === platformId);
      expect(entry, platformId).toBeDefined();
      expect(entry?.kind).toBe("email");
      expect(entry?.icon ?? null).toBe(icon);
    }
  });

  it("match addresses by domain, case-insensitively", () => {
    expect(emailProvider("Owl@GMail.com")?.name).toBe("Gmail");
    expect(emailProvider("owl@hotmail.com")?.platformId).toBe("builtin-pl-outlook");
    expect(emailProvider("owl@pm.me")?.icon).toBe("protonmail");
    expect(emailProvider("owl@example.com")).toBeNull();
    expect(emailProvider(null)).toBeNull();
  });

  it("give an email account without a platform its provider's mark", () => {
    const mail = {
      accountType: "email" as const,
      title: "Primary email",
      email: "owl@gmail.com",
      publisher: null,
      platformName: null,
      platformIcon: null,
      gameName: null,
      gameIcon: null,
    };
    expect(accountMark(mail)).toEqual({ icon: "gmail", name: "Gmail" });
    expect(accountMark({ ...mail, email: "owl@outlook.com" })).toEqual({ icon: null, name: "Outlook.com" });
    // Only email accounts: a launcher's login email says nothing about it.
    expect(accountMark({ ...mail, accountType: "launcher" })).toEqual({ icon: null, name: "Primary email" });
  });
});

describe("account list logos and filters", () => {
  it("shows the platform logo, or initials when there's no logo", async () => {
    await renderApp("/accounts", handlers());
    const table = await screen.findByRole("table", { name: "All Accounts" });
    const [, steam, xbox, plain] = within(table).getAllByRole("row");
    expect(steam?.querySelector("[data-logo]")?.getAttribute("data-logo")).toBe("steam");
    expect(xbox?.querySelector("[data-logo]")?.getAttribute("data-logo")).toBe("monogram");
    expect(xbox).toHaveTextContent("X");
    expect(plain?.querySelector("[data-logo]")?.textContent).toBe("OL");
    // A logo stands free; only the initials placeholder sits in a tile.
    expect(steam?.querySelector("[data-logo]")?.className).not.toMatch(/(^| )border( |$)/);
    expect(xbox?.querySelector("[data-logo]")?.className).toMatch(/(^| )border( |$)/);
  });

  it("filters by platform in Rust", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/accounts", handlers());
    await screen.findByRole("table", { name: "All Accounts" });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Filter by platform" }), "Steam");
    await waitFor(() => {
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      cmd: "account_list",
      args: {
        archived: false,
        filter: {
          platformId: "builtin-pl-steam",
          gameId: null,
          publisher: null,
        },
      },
    });
  });
});

describe("games and platforms pages", () => {
  it("groups accounts and game profiles under each platform in use", async () => {
    const user = userEvent.setup();
    await renderApp("/platforms", handlers());
    const steam = await screen.findByRole("region", { name: "Steam" });
    expect(within(steam).getByText("Launcher · Valve · 1 account · 1 profile")).toBeInTheDocument();
    expect(within(steam).getByRole("link", { name: /^Game store \(main\)/ })).toBeInTheDocument();
    expect(within(steam).getByRole("link", { name: /NightOwl#EUW/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Xbox" })).toBeInTheDocument();
    // Unused entries wait behind a toggle.
    expect(screen.queryByText("Discord")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /More platforms in the catalog \(1\)/,
      }),
    );
    expect(screen.getByText("Discord")).toBeInTheDocument();
  });

  it("adds a game", async () => {
    const user = userEvent.setup();
    const created = game({
      id: "g-new",
      name: "Arena Legends",
      isBuiltin: false,
      icon: null,
    });
    const gameCreate = vi.fn(() => created);
    await renderApp("/games", handlers({ game_create: gameCreate }));
    await screen.findByRole("region", { name: "Valorant" });
    await user.click(screen.getByRole("button", { name: "Add game" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a game" });
    await user.type(within(dialog).getByLabelText("Name"), "Arena Legends");
    await user.type(within(dialog).getByLabelText("Publisher"), "Example Publisher");
    await user.click(within(dialog).getByRole("button", { name: "Add game" }));
    await waitFor(() => {
      expect(gameCreate).toHaveBeenCalledWith({
        input: {
          name: "Arena Legends",
          franchise: null,
          publisher: "Example Publisher",
        },
      });
    });
  });

  it("says so when no game is in use", async () => {
    await renderApp("/games", handlers({ game_list: () => [game({})] }));
    expect(await screen.findByRole("heading", { name: "No games yet" })).toBeInTheDocument();
  });
});

describe("account detail", () => {
  it("offers the catalog login page, labelled as such, and lists game profiles", async () => {
    await renderApp("/accounts/a1", handlers());
    expect(await screen.findByText("https://store.steampowered.com/login/")).toBeInTheDocument();
    expect(screen.getByText(/From the Steam catalog entry/)).toBeInTheDocument();
    const profiles = screen.getByRole("region", { name: "Game profiles" });
    expect(await within(profiles).findByText("NightOwl#EUW")).toBeInTheDocument();
    expect(within(profiles).getByText("Valorant · Steam · Diamond 2 · EU")).toBeInTheDocument();
  });

  it("adds a game profile to the account", async () => {
    const user = userEvent.setup();
    const create = vi.fn(() => PROFILE);
    await renderApp("/accounts/a1", handlers({ game_profile_list: () => [], game_profile_create: create }));
    await user.click(await screen.findByRole("button", { name: "Add profile" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add game profile",
    });
    await user.click(within(dialog).getByRole("button", { name: "Add profile" }));
    expect(await within(dialog).findByText("Choose the game.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Game"), "Valorant");
    await user.type(within(dialog).getByLabelText("Gamertag"), "NightOwl#EUW");
    await user.type(within(dialog).getByLabelText("Rank or tier"), "Diamond 2");
    await user.click(within(dialog).getByRole("button", { name: "Add profile" }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        accountId: "a1",
        input: expect.objectContaining({
          gameId: "builtin-game-valorant",
          platformId: "builtin-pl-steam",
          gamertag: "NightOwl#EUW",
          rankTier: "Diamond 2",
        }) as unknown,
      });
    });
  });
});

describe("accessibility", () => {
  it.each([
    ["the platforms page", "/platforms", "Steam"],
    ["the games page", "/games", "Valorant"],
  ])("%s has no axe violations", async (_name, path, ready) => {
    const { container } = await renderApp(path, handlers());
    await screen.findByRole("region", { name: ready });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("account form: filling in from the email", () => {
  const GMAIL = platform({
    id: "builtin-pl-gmail",
    name: "Gmail",
    kind: "email",
    publisher: "Google",
    defaultLoginUrl: "https://mail.google.com/",
    icon: "gmail",
  });
  const withGmail = () => handlers({ platform_list: () => [...PLATFORMS, GMAIL] });

  it("makes a blank new account the mailbox of a known provider, with Undo", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts/new", withGmail());
    await user.type(await screen.findByLabelText("Email"), "owl@gmail.com");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Filled in from the address: type Email, platform Gmail, name “Gmail”, publisher Google.",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Type").value).toBe("email");
    expect(screen.getByLabelText<HTMLSelectElement>("Platform").value).toBe("builtin-pl-gmail");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Gmail");
    expect(screen.getByLabelText<HTMLInputElement>("Publisher").value).toBe("Google");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText<HTMLSelectElement>("Type").value).toBe("launcher");
    expect(screen.getByLabelText<HTMLSelectElement>("Platform").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
    // Undone on purpose: editing the address again doesn't refill.
    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.getByLabelText<HTMLSelectElement>("Platform").value).toBe("");
  });

  it("leaves an account the user has started alone: the email is just its login", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts/new", withGmail());
    await user.type(await screen.findByLabelText("Name"), "Steam main");
    await user.type(screen.getByLabelText("Email"), "owl@gmail.com");
    expect(screen.queryByText(/Filled in from the address/)).not.toBeInTheDocument();
    expect(screen.getByLabelText<HTMLSelectElement>("Type").value).toBe("launcher");
    expect(screen.getByLabelText<HTMLSelectElement>("Platform").value).toBe("");
  });

  it("ignores addresses at unknown domains", async () => {
    const user = userEvent.setup();
    await renderApp("/accounts/new", withGmail());
    await user.type(await screen.findByLabelText("Email"), "owl@example.com");
    expect(screen.queryByText(/Filled in from the address/)).not.toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
  });
});
