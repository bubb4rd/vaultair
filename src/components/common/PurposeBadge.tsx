import { usePurposes } from "@/app/queries";
import type { PurposeColor } from "@/ipc/client";
import { cn } from "@/lib/utils";

/**
 * Purpose colours: the identity palette, never a status colour. Class names
 * are spelled out in full so Tailwind finds them.
 */
export const PURPOSE_COLORS: { value: PurposeColor; label: string; dot: string }[] = [
  { value: "blue", label: "Blue", dot: "bg-identity-blue" },
  { value: "violet", label: "Violet", dot: "bg-identity-violet" },
  { value: "teal", label: "Teal", dot: "bg-identity-teal" },
  { value: "amber", label: "Amber", dot: "bg-identity-amber" },
  { value: "rose", label: "Rose", dot: "bg-identity-rose" },
  { value: "slate", label: "Slate", dot: "bg-identity-slate" },
];

const NO_COLOR = "border border-input";

export function purposeDot(color: PurposeColor | null) {
  return PURPOSE_COLORS.find((c) => c.value === color)?.dot ?? NO_COLOR;
}

/** A dot in the label's colour. Decorative: pair it with the name. */
export function PurposeDot({ color, className }: { color: PurposeColor | null; className?: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", purposeDot(color), className)} />;
}

/**
 * An account's purpose: the name after a dot in its label's colour. The one
 * way account views show a purpose, so a label's colour (and a hidden
 * label, which accounts keep) reads the same everywhere.
 */
export function PurposeBadge({
  purposeId,
  name,
  className,
}: {
  purposeId: string;
  name: string;
  className?: string;
}) {
  const color = usePurposes().data?.find((p) => p.id === purposeId)?.color ?? null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} data-purpose-color={color ?? "none"}>
      <PurposeDot color={color} />
      <span className="truncate">{name}</span>
    </span>
  );
}
