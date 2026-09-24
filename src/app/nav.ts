import type { Icon } from "@phosphor-icons/react";
import {
  AppWindowIcon,
  ArchiveIcon,
  GameControllerIcon,
  GearSixIcon,
  GraphIcon,
  IdentificationBadgeIcon,
  KeyIcon,
  PulseIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";

export interface NavItem {
  path: string;
  label: string;
  icon: Icon;
  empty: { title: string; description: string };
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
        empty: {
          title: "Your vault at a glance",
          description:
            "Once you add accounts, this page shows what needs attention: weak or reused passwords, missing MFA and recovery gaps.",
        },
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
        empty: {
          title: "No identities yet",
          description:
            "An identity groups the accounts, emails and handles that belong to one persona, such as your main or a creator profile.",
        },
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
        empty: {
          title: "No games yet",
          description: "Games you track appear here with the accounts and in-game profiles linked to each one.",
        },
      },
      {
        path: "/platforms",
        label: "Platforms",
        icon: AppWindowIcon,
        empty: {
          title: "No platforms yet",
          description:
            "Launchers and services such as Steam, Battle.net or Riot appear here with the accounts on each.",
        },
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
        empty: {
          title: "No checks to run yet",
          description:
            "Vaultair checks for weak and reused passwords, missing MFA and missing recovery codes. Results appear here with these labels.",
        },
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  path: "/settings",
  label: "Settings",
  icon: GearSixIcon,
  empty: {
    title: "Settings arrive with your vault",
    description: "Lock timeout, clipboard clearing, privacy and backup options will live here.",
  },
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
