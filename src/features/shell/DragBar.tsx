import type { ReactNode } from "react";
import { WindowControls } from "./WindowControls";

/**
 * Top strip for full-screen views (onboarding, lock screen). It is not a
 * title bar: no title, no border. It only gives the frameless window a place
 * to drag from and holds the window controls.
 */
export function DragBar({ children }: { children?: ReactNode }) {
  return (
    <div data-tauri-drag-region className="flex h-[var(--header-height)] shrink-0 items-center gap-3 pr-2 pl-4">
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2.5">
        {children}
      </div>
      <WindowControls />
    </div>
  );
}
