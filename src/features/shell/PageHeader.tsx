import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { WindowControls } from "./WindowControls";

export interface BreadcrumbItem {
  label: string;
  to?: string;
  params?: Record<string, string>;
  /** Restricts maximum width and enables ellipsis for intermediate dynamic links (e.g. long account title in Edit route) */
  truncate?: boolean;
}

export interface PageHeaderProps {
  /** Explicit breadcrumb trail. Takes precedence over `title`. */
  crumbs?: BreadcrumbItem[];
  /** Convenience prop: when `crumbs` is omitted, generates `[{ label: "Vault", to: "/" }, { label: title }]`. */
  title?: string;
  actions?: ReactNode;
}

/**
 * Page header doubles as the window's drag region (there is no title bar).
 * Tauri only drags when the pressed element itself carries the attribute, so
 * the non-interactive children carry it too; clickable links and buttons don't,
 * so they click.
 */
export function PageHeader({ crumbs: explicitCrumbs, title, actions }: PageHeaderProps) {
  const crumbs: BreadcrumbItem[] =
    explicitCrumbs ?? (title ? [{ label: "Vault", to: "/" }, { label: title }] : []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--header-height)] shrink-0 items-center gap-3 border-b border-border pr-2 pl-6"
    >
      <nav data-tauri-drag-region aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        <ol data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 text-[15px]">
          {crumbs.map((crumb, idx) => {
            const isLast = idx === crumbs.length - 1;

            if (isLast) {
              return (
                <li key={idx} data-tauri-drag-region className="flex min-w-0 items-center">
                  <h1
                    data-tauri-drag-region
                    aria-current="page"
                    className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground"
                  >
                    {crumb.label}
                  </h1>
                </li>
              );
            }

            return (
              <li
                key={idx}
                data-tauri-drag-region
                className={cn("flex items-center gap-1.5", crumb.truncate ? "min-w-0" : "shrink-0")}
              >
                {crumb.to ? (
                  <Link
                    to={crumb.to}
                    params={crumb.params}
                    className={cn(
                      "rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                      crumb.truncate && "max-w-[220px] truncate",
                    )}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    data-tauri-drag-region
                    className={cn("text-muted-foreground", crumb.truncate && "max-w-[220px] truncate")}
                  >
                    {crumb.label}
                  </span>
                )}
                <span
                  data-tauri-drag-region
                  aria-hidden="true"
                  className="select-none text-muted-foreground/50"
                >
                  /
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      {actions}
      <WindowControls />
    </header>
  );
}
