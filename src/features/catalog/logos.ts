import type { SimpleIcon } from "simple-icons";
import { MANIFEST, SIMPLE_ICONS, type LogoRecord } from "./logos.generated";

/**
 * What stands for a platform, game or account: a Simple Icons path (CC0), a
 * reviewed file, or initials in a tile. The marks stay their owners'
 * trademarks and are shown only to identify the service. Everything is
 * bundled by `npm run logos:build` from the manifest
 * (`crates/vaultair-core/catalog/logos.json`); nothing is fetched at runtime.
 */
export type Mark =
  | { kind: "path"; slug: string; path: string; hex: string }
  | { kind: "file"; src: string }
  | { kind: "monogram"; color: string | null };

/** Own keys only: ids and slugs come from the vault, and "constructor" isn't a logo. */
function pick<T>(map: Record<string, T>, key: string | null | undefined): T | undefined {
  return key && Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * The first of: the manifest record for the catalog id; the legacy `icon`
 * slug stored on the vault row; a neutral monogram. Resolving by id means a
 * logo added to the manifest reaches every vault on the next update, where
 * the stored slug is fixed when the vault is seeded.
 */
export function resolveMark(
  manifest: Record<string, LogoRecord>,
  icons: Record<string, SimpleIcon>,
  id: string | null | undefined,
  icon: string | null | undefined,
): Mark {
  const record = pick(manifest, id);
  if (record?.kind === "file") return { kind: "file", src: record.src };
  if (record?.kind === "monogram") return { kind: "monogram", color: record.color ?? null };
  const named = pick(icons, record?.slug);
  if (named) return { kind: "path", slug: named.slug, path: named.path, hex: record?.color ?? named.hex };
  const legacy = pick(icons, icon);
  if (legacy) return { kind: "path", slug: legacy.slug, path: legacy.path, hex: legacy.hex };
  return { kind: "monogram", color: null };
}

/** The mark for a catalog entry, by its id and (for rows the manifest doesn't cover) its stored slug. */
export function logoFor(id: string | null | undefined, icon: string | null | undefined): Mark {
  return resolveMark(MANIFEST, SIMPLE_ICONS, id, icon);
}

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
 * built-in catalog platform, whose mark they share. An email account without
 * a platform shows its provider's mark, and the form offers to set that
 * platform. Only for email accounts: a game account's login email says
 * nothing about the game.
 */
const EMAIL_PROVIDERS: { platformId: string; name: string; domains: string[] }[] = [
  { platformId: "builtin-pl-gmail", name: "Gmail", domains: ["gmail.com", "googlemail.com"] },
  {
    platformId: "builtin-pl-outlook",
    name: "Outlook.com",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.co.uk", "outlook.co.uk", "live.co.uk"],
  },
  {
    platformId: "builtin-pl-proton",
    name: "Proton Mail",
    domains: ["proton.me", "protonmail.com", "protonmail.ch", "pm.me"],
  },
  { platformId: "builtin-pl-icloud", name: "iCloud Mail", domains: ["icloud.com", "me.com", "mac.com"] },
  {
    platformId: "builtin-pl-yahoo",
    name: "Yahoo Mail",
    domains: ["yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk"],
  },
  { platformId: "builtin-pl-aol", name: "AOL Mail", domains: ["aol.com"] },
  { platformId: "builtin-pl-zoho", name: "Zoho Mail", domains: ["zoho.com", "zohomail.com"] },
  {
    platformId: "builtin-pl-tuta",
    name: "Tuta",
    domains: ["tuta.com", "tuta.io", "tutanota.com", "tutanota.de", "tutamail.com", "keemail.me"],
  },
  { platformId: "builtin-pl-fastmail", name: "Fastmail", domains: ["fastmail.com", "fastmail.fm"] },
  { platformId: "builtin-pl-gmx", name: "GMX", domains: ["gmx.com", "gmx.net", "gmx.de"] },
  { platformId: "builtin-pl-maildotcom", name: "mail.com", domains: ["mail.com"] },
  { platformId: "builtin-pl-mailru", name: "Mail.ru", domains: ["mail.ru", "inbox.ru", "list.ru", "bk.ru"] },
  { platformId: "builtin-pl-yandex", name: "Yandex Mail", domains: ["yandex.com", "yandex.ru", "ya.ru"] },
  { platformId: "builtin-pl-hey", name: "HEY", domains: ["hey.com"] },
  { platformId: "builtin-pl-mailboxorg", name: "mailbox.org", domains: ["mailbox.org"] },
];

/** The provider an address is at, from its domain. `null` if unknown. */
export function emailProvider(email: string | null | undefined) {
  const domain = email?.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  return EMAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

/** For tests: every provider's platform id. */
export const EMAIL_PROVIDER_IDS = EMAIL_PROVIDERS.map((p) => p.platformId);
