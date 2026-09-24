import type { ReactNode } from "react";
import { WindowControls } from "./WindowControls";

/**
 * Page header doubles as the window's drag region (there is no title bar).
 * Tauri only drags when the pressed element itself carries the attribute, so
 * the non-interactive children carry it too; buttons don't, so they click.
 */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--header-height)] shrink-0 items-center gap-3 border-b border-border pr-2 pl-6"
    >
      <h1 data-tauri-drag-region className="flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
        {title}
      </h1>
      {actions}
      <WindowControls />
    </header>
  );
}
