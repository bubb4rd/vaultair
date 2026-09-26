import type { AccountSummary } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { emailProvider, logoColor, logoFor, monogram } from "./logos";

const SIZES = {
  xs: { box: "size-6 rounded", glyph: "size-[18px]", text: "text-[9px]" },
  sm: { box: "size-8 rounded-md", glyph: "size-6", text: "text-[11px]" },
  lg: { box: "size-11 rounded-lg", glyph: "size-9", text: "text-sm" },
} as const;

/**
 * A platform's or game's logo, drawn free-standing like the mark it is, or
 * its initials in a tile when there's no bundled logo (user-added entries,
 * and brands Simple Icons doesn't carry). Both take the same space, so names
 * line up in lists either way. Decorative: always shown next to the name, so
 * it's hidden from screen readers.
 */
export function CatalogLogo({
  icon,
  name,
  size = "sm",
  className,
}: {
  icon: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES | undefined;
  className?: string | undefined;
}) {
  const logo = logoFor(icon);
  const s = SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-logo={logo ? logo.slug : "monogram"}
      className={cn(
        "grid shrink-0 place-items-center",
        s.box,
        logo ? "text-foreground" : "border border-border-strong bg-card text-muted-foreground",
        className,
      )}
    >
      {logo ? (
        <svg viewBox="0 0 24 24" className={s.glyph} fill={logoColor(logo.hex) ?? "currentColor"}>
          <path d={logo.path} />
        </svg>
      ) : (
        <span className={cn("font-semibold tracking-tight", s.text)}>{monogram(name)}</span>
      )}
    </span>
  );
}

/**
 * The mark that stands for an account: for a game account its game first,
 * otherwise its platform first; then the other; then, as a placeholder, the
 * initials of its publisher or title. An email account with neither uses
 * its address's provider, so a Gmail address shows Gmail's logo.
 */
export function accountMark(
  account: Pick<
    AccountSummary,
    "accountType" | "title" | "email" | "publisher" | "platformName" | "platformIcon" | "gameName" | "gameIcon"
  >,
): { icon: string | null; name: string } {
  const platform = account.platformName ? { icon: account.platformIcon, name: account.platformName } : null;
  const game = account.gameName ? { icon: account.gameIcon, name: account.gameName } : null;
  const [first, second] = account.accountType === "game" ? [game, platform] : [platform, game];
  const found = [first, second].find((m) => m && logoFor(m.icon)) ?? first ?? second;
  if (found) return found;
  const provider = account.accountType === "email" ? emailProvider(account.email) : null;
  if (provider) return { icon: provider.icon, name: provider.name };
  return { icon: null, name: account.publisher ?? account.title };
}

export function AccountLogo({
  account,
  size,
  className,
}: {
  account: Parameters<typeof accountMark>[0];
  size?: keyof typeof SIZES | undefined;
  className?: string | undefined;
}) {
  const mark = accountMark(account);
  return <CatalogLogo icon={mark.icon} name={mark.name} size={size} className={className} />;
}
