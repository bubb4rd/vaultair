import type { IdentityColor } from "@/ipc/client";
import { cn } from "@/lib/utils";

/**
 * Identity accents. Class names are spelled out in full so Tailwind finds
 * them. The colour is decoration only: the name always sits next to it.
 */
export const IDENTITY_COLORS: { value: IdentityColor; label: string; swatch: string; tint: string }[] = [
  { value: "blue", label: "Blue", swatch: "bg-identity-blue", tint: "bg-identity-blue/15 text-identity-blue" },
  { value: "violet", label: "Violet", swatch: "bg-identity-violet", tint: "bg-identity-violet/15 text-identity-violet" },
  { value: "teal", label: "Teal", swatch: "bg-identity-teal", tint: "bg-identity-teal/15 text-identity-teal" },
  { value: "amber", label: "Amber", swatch: "bg-identity-amber", tint: "bg-identity-amber/15 text-identity-amber" },
  { value: "rose", label: "Rose", swatch: "bg-identity-rose", tint: "bg-identity-rose/15 text-identity-rose" },
  { value: "slate", label: "Slate", swatch: "bg-identity-slate", tint: "bg-identity-slate/15 text-identity-slate" },
];

const NEUTRAL = "bg-muted text-muted-foreground";

function tintOf(color: IdentityColor | null) {
  return IDENTITY_COLORS.find((c) => c.value === color)?.tint ?? NEUTRAL;
}

/** Up to two initials: "Competitive" → "C", "Creator main" → "CM". */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

const SIZES = {
  xs: "size-5 rounded text-[10px]",
  sm: "size-8 rounded-md text-xs",
  lg: "size-11 rounded-lg text-[15px]",
} as const;

/** A tinted square with the identity's initials. Decorative: pair it with the name. */
export function IdentityAvatar({
  name,
  color,
  size = "sm",
  className,
}: {
  name: string;
  color: IdentityColor | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center font-semibold", SIZES[size], tintOf(color), className)}
    >
      {initials(name)}
    </span>
  );
}

/** Avatar and name inline, for tables and summaries. */
export function IdentityChip({ name, color }: { name: string; color: IdentityColor | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <IdentityAvatar name={name} color={color} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
}
