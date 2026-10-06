import type { CSSProperties } from "react";
import type { AccountSummary } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { emailProvider, logoColor, logoFor, monogram } from "./logos";

const SIZES = {
  xs: { box: "size-6 rounded", glyph: "size-[18px]", text: "text-[9px]" },
  sm: { box: "size-8 rounded-md", glyph: "size-6", text: "text-[11px]" },
  lg: { box: "size-11 rounded-lg", glyph: "size-9", text: "text-sm" },
} as const;

const NEUTRAL_TILE = "border border-border-strong bg-card text-muted-foreground";
/** The same tile, filled and edged with the brand colour mixed into the card. */
const TINTED_TILE =
  "border border-[color:color-mix(in_oklab,var(--logo-tint)_45%,var(--card))] bg-[color-mix(in_oklab,var(--logo-tint)_15%,var(--card))] text-foreground";

/**
 * A platform's or game's logo, drawn free-standing like the mark it is, or
 * its initials in a tile when there's no logo to bundle: a neutral tile for
 * user-added entries, one tinted with the brand colour for built-ins whose
 * owners don't license their mark. All take the same space, so names line up
 * in lists either way. Found by the catalog `id`, then by the stored `icon`
 * slug. Decorative: always shown next to the name, so it's hidden from
 * screen readers.
 */
export function CatalogLogo({
  id,
  icon,
  name,
  size = "sm",
  className,
}: {
  id?: string | null | undefined;
  icon: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES | undefined;
  className?: string | undefined;
}) {
  const mark = logoFor(id, icon);
  const s = SIZES[size];
  if (mark.kind === "monogram") {
    // The initials take the brand colour only where it reads on the card.
    const tint = mark.color
      ? ({ "--logo-tint": `#${mark.color}`, color: logoColor(mark.color) ?? undefined } as CSSProperties)
      : undefined;
    return (
      <span
        aria-hidden="true"
        data-logo="monogram"
        className={cn("grid shrink-0 place-items-center", s.box, tint ? TINTED_TILE : NEUTRAL_TILE, className)}
        style={tint}
      >
        <span className={cn("font-semibold tracking-tight", s.text)}>{monogram(name)}</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-logo={mark.kind === "path" ? mark.slug : `file:${id ?? ""}`}
      className={cn("grid shrink-0 place-items-center text-foreground", s.box, className)}
    >
      {mark.kind === "path" ? (
        <svg viewBox="0 0 24 24" className={s.glyph} fill={logoColor(mark.hex) ?? "currentColor"}>
          <path d={mark.path} />
        </svg>
      ) : (
        // A reviewed file is only ever an image: its markup never enters the page.
        <img src={mark.src} alt="" draggable={false} className={cn("object-contain", s.glyph)} />
      )}
    </span>
  );
}

/**
 * The mark that stands for an account: for a game account its game first,
 * otherwise its platform first, preferring whichever has a logo; then, as a
 * placeholder, the initials of its publisher or title. An email account with
 * neither uses its address's provider, so a Gmail address shows Gmail's logo.
 */
export function accountMark(
  account: Pick<
    AccountSummary,
    | "accountType"
    | "title"
    | "email"
    | "publisher"
    | "platformId"
    | "platformName"
    | "platformIcon"
    | "gameId"
    | "gameName"
    | "gameIcon"
  >,
): { id: string | null; icon: string | null; name: string } {
  const platform = account.platformName
    ? { id: account.platformId, icon: account.platformIcon, name: account.platformName }
    : null;
  const game = account.gameName ? { id: account.gameId, icon: account.gameIcon, name: account.gameName } : null;
  const [first, second] = account.accountType === "game" ? [game, platform] : [platform, game];
  const found = [first, second].find((m) => m && logoFor(m.id, m.icon).kind !== "monogram") ?? first ?? second;
  if (found) return found;
  const provider = account.accountType === "email" ? emailProvider(account.email) : null;
  if (provider) return { id: provider.platformId, icon: null, name: provider.name };
  return { id: null, icon: null, name: account.publisher ?? account.title };
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
  return <CatalogLogo id={mark.id} icon={mark.icon} name={mark.name} size={size} className={className} />;
}
