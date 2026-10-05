import type { Icon } from "@phosphor-icons/react";
import {
  AppWindowIcon,
  ArchiveIcon,
  GameControllerIcon,
  GearSixIcon,
  GraphIcon,
  IdentificationBadgeIcon,
  KeyIcon,
  PasswordIcon,
  PulseIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";

export interface NavItem {
  path: string;
  label: string;
  icon: Icon;
  /** Extra words the Ctrl+K palette matches. */
  keywords?: string[];
  /** Placeholder copy for pages whose feature hasn't landed. Pages with real content (see `router.tsx`) omit it. */
  empty?: { title: string; description: string };
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * Sidebar destinations (implementation plan, Phase 2). Order is the sidebar order.
 * Favorites is not a page: it is a sidebar section listing starred accounts
 * (`FavoritesGroup`), placed after the "Vault" group.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      {
        path: "/",
        label: "Dashboard",
        icon: SquaresFourIcon,
      },
    ],
  },
  {
    label: "Vault",
    items: [
      {
        path: "/accounts",
        label: "All Accounts",
        icon: KeyIcon,
        empty: {
          title: "No accounts yet",
          description:
            "Every account you add, across every game and platform, is listed here with its purpose, identity and security status.",
        },
      },
      {
        path: "/identities",
        label: "Identities",
        icon: IdentificationBadgeIcon,
        keywords: ["persona", "profile"],
      },
      {
        path: "/archived",
        label: "Archived",
        icon: ArchiveIcon,
        empty: {
          title: "Nothing archived",
          description:
            "Archived accounts stay in your vault but are left out of lists and security checks.",
        },
      },
    ],
  },
  {
    label: "Catalog",
    items: [
      {
        path: "/games",
        label: "Games",
        icon: GameControllerIcon,
        keywords: ["game profiles", "gamertag", "rank"],
      },
      {
        path: "/platforms",
        label: "Platforms",
        icon: AppWindowIcon,
        keywords: ["launchers", "catalog"],
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        path: "/map",
        label: "Relationship Map",
        icon: GraphIcon,
        empty: {
          title: "Nothing to map yet",
          description:
            "Links between identities, accounts, emails and recovery methods are drawn here as you add them.",
        },
      },
      {
        path: "/health",
        label: "Security Health",
        icon: PulseIcon,
        keywords: ["weak password", "reused", "mfa", "recovery codes", "dormant"],
      },
    ],
  },
  {
    label: "Tools",
    items: [
      {
        path: "/generator",
        label: "Generator",
        icon: PasswordIcon,
        keywords: ["password", "passphrase", "generate"],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  path: "/settings",
  label: "Settings",
  icon: GearSixIcon,
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/**
 * Paths of sidebar pages, for links from inside features. They're typed as
 * plain strings because these routes are built from `NAV_GROUPS` at runtime,
 * so the router can't list them in its typed path union.
 */
export const PAGE_PATHS: Record<"accounts" | "archived" | "identities" | "games" | "platforms" | "health", string> = {
  accounts: "/accounts",
  archived: "/archived",
  identities: "/identities",
  games: "/games",
  platforms: "/platforms",
  health: "/health",
};
