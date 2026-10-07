import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { onClipboardClearedByRust } from "@/features/clipboard/copy";
import { lockVault } from "@/features/lock/lockVault";
import { onClipboardCleared } from "@/ipc/events";
import { CaptureGuard } from "@/features/settings/CaptureGuard";
import { ActivityTracker } from "./ActivityTracker";
import { CommandPalette } from "./CommandPalette";
import { HelloOffer } from "./HelloOffer";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => onClipboardCleared(onClipboardClearedByRust), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl only. On Windows `metaKey` is the Windows key, and Win+L, Win+K
      // and the rest belong to the OS (lock screen, Cast); never claim them.
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (key === "l") {
        e.preventDefault();
        lockVault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar
        onOpenSearch={() => {
          setPaletteOpen(true);
        }}
      />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ActivityTracker />
      <CaptureGuard />
      <HelloOffer />
    </div>
  );
}
