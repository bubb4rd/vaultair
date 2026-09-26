import type { SimpleIcon } from "simple-icons";
import {
  siActivision,
  siBattledotnet,
  siCounterstrike,
  siDiscord,
  siDota2,
  siEa,
  siEpicgames,
  siFortnite,
  siGmail,
  siGmx,
  siGogdotcom,
  siIcloud,
  siHey,
  siItchdotio,
  siKick,
  siLeagueoflegends,
  siMailbox,
  siMaildotcom,
  siMaildotru,
  siOsu,
  siPlaystation,
  siProtonmail,
  siPubg,
  siReddit,
  siRiotgames,
  siRoblox,
  siRockstargames,
  siSteam,
  siTuta,
  siTwitch,
  siUbisoft,
  siValorant,
  siX,
  siYoutube,
  siZoho,
} from "simple-icons";

/**
 * Bundled brand logos, by the slug a catalog entry's `icon` names
 * (`crates/vaultair-core/catalog/default_catalog.json`). From Simple Icons
 * (CC0); the marks stay their owners' trademarks and are shown only to
 * identify the service. Only these are imported, so the rest of the set
 * isn't bundled. Nothing is fetched at runtime.
 */
const LOGOS: Record<string, SimpleIcon> = {
  activision: siActivision,
  battledotnet: siBattledotnet,
  counterstrike: siCounterstrike,
  discord: siDiscord,
  dota2: siDota2,
  ea: siEa,
  epicgames: siEpicgames,
  fortnite: siFortnite,
  gmail: siGmail,
  gmx: siGmx,
  hey: siHey,
  gogdotcom: siGogdotcom,
  icloud: siIcloud,
  itchdotio: siItchdotio,
  kick: siKick,
  leagueoflegends: siLeagueoflegends,
  mailbox: siMailbox,
  maildotcom: siMaildotcom,
  maildotru: siMaildotru,
  osu: siOsu,
  playstation: siPlaystation,
  protonmail: siProtonmail,
  pubg: siPubg,
  reddit: siReddit,
  riotgames: siRiotgames,
  roblox: siRoblox,
  rockstargames: siRockstargames,
  steam: siSteam,
  tuta: siTuta,
  twitch: siTwitch,
  ubisoft: siUbisoft,
  valorant: siValorant,
  x: siX,
  youtube: siYoutube,
  zoho: siZoho,
};

export function logoFor(icon: string | null | undefined): SimpleIcon | null {
  return icon ? (LOGOS[icon] ?? null) : null;
}

/** The slugs with a bundled logo (tests check the catalog against it). */
export const LOGO_SLUGS = Object.keys(LOGOS);

/** `--card`, the darkest surface a logo sits on. */
const SURFACE = "17181c";

function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The brand colour if it reaches 3:1 against the card surface (WCAG 1.4.11
 * for graphics), otherwise `null`: draw it in the text colour instead, so
 * black and near-black marks (Steam, Epic, EA) stay visible on the dark UI.
 */
export function logoColor(hex: string): string | null {
  const contrast = (luminance(hex) + 0.05) / (luminance(SURFACE) + 0.05);
  return contrast >= 3 ? `#${hex}` : null;
}

/** "Nintendo Account" -> "NA", "Xbox" -> "X", "osu!" -> "O". */
export function monogram(name: string): string {
  const words = name
    .split(/[\s._\-:]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * Email providers by the domains their addresses use, pointing at the
 * built-in catalog platform (and its logo, if Simple Icons has one). An email
 * account without a platform shows its provider's mark, and the form offers
 * to set that platform. Only for email accounts: a game account's login
 * email says nothing about the game.
 */
const EMAIL_PROVIDERS: { platformId: string; name: string; icon: string | null; domains: string[] }[] = [
  { platformId: "builtin-pl-gmail", name: "Gmail", icon: "gmail", domains: ["gmail.com", "googlemail.com"] },
  {
    platformId: "builtin-pl-outlook",
    name: "Outlook.com",
    icon: null,
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.co.uk", "outlook.co.uk", "live.co.uk"],
  },
  {
    platformId: "builtin-pl-proton",
    name: "Proton Mail",
    icon: "protonmail",
    domains: ["proton.me", "protonmail.com", "protonmail.ch", "pm.me"],
  },
  {
    platformId: "builtin-pl-icloud",
    name: "iCloud Mail",
    icon: "icloud",
    domains: ["icloud.com", "me.com", "mac.com"],
  },
  {
    platformId: "builtin-pl-yahoo",
    name: "Yahoo Mail",
    icon: null,
    domains: ["yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk"],
  },
  { platformId: "builtin-pl-aol", name: "AOL Mail", icon: null, domains: ["aol.com"] },
  { platformId: "builtin-pl-zoho", name: "Zoho Mail", icon: "zoho", domains: ["zoho.com", "zohomail.com"] },
  {
    platformId: "builtin-pl-tuta",
    name: "Tuta",
    icon: "tuta",
    domains: ["tuta.com", "tuta.io", "tutanota.com", "tutanota.de", "tutamail.com", "keemail.me"],
  },
  { platformId: "builtin-pl-fastmail", name: "Fastmail", icon: null, domains: ["fastmail.com", "fastmail.fm"] },
  { platformId: "builtin-pl-gmx", name: "GMX", icon: "gmx", domains: ["gmx.com", "gmx.net", "gmx.de"] },
  { platformId: "builtin-pl-maildotcom", name: "mail.com", icon: "maildotcom", domains: ["mail.com"] },
  {
    platformId: "builtin-pl-mailru",
    name: "Mail.ru",
    icon: "maildotru",
    domains: ["mail.ru", "inbox.ru", "list.ru", "bk.ru"],
  },
  { platformId: "builtin-pl-yandex", name: "Yandex Mail", icon: null, domains: ["yandex.com", "yandex.ru", "ya.ru"] },
  { platformId: "builtin-pl-hey", name: "HEY", icon: "hey", domains: ["hey.com"] },
  { platformId: "builtin-pl-mailboxorg", name: "mailbox.org", icon: "mailbox", domains: ["mailbox.org"] },
];

/** The provider an address is at, from its domain. `null` if unknown. */
export function emailProvider(email: string | null | undefined) {
  const domain = email?.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  return EMAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

/** For tests: every provider's platform id and logo. */
export const EMAIL_PROVIDER_ENTRIES = EMAIL_PROVIDERS.map(({ platformId, icon }) => ({ platformId, icon }));
