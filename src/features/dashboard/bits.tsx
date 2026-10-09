import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Formatting and small pieces the dashboard's sections share. */

export const number = new Intl.NumberFormat();
export const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
export const link = "rounded-sm focus-visible:outline-2 focus-visible:outline-ring";
export const sectionTitle = "text-[13px] font-semibold text-foreground";
export const bigNumber = "text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums";

/** "1 account" / "3 accounts". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

/**
 * A small brand-coloured link with an arrow, for "All accounts" and the like.
 * `hash` names a heading on the target page to scroll to.
 */
export function MoreLink({ to, hash, children }: { to: string; hash?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      {...(hash ? { hash } : {})}
      className={cn(link, "inline-flex items-center gap-1 text-xs text-brand hover:underline")}
    >
      {children}
      <ArrowRightIcon aria-hidden="true" className="size-3" />
    </Link>
  );
}
