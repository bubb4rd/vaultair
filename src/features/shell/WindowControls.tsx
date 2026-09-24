import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopySimpleIcon, MinusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Minimize / maximize / close for the frameless window. There is no title bar:
 * these sit at the right end of the page header.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const sync = () => {
      win
        .isMaximized()
        .then((m) => {
          if (!disposed) setMaximized(m);
        })
        .catch(() => undefined);
    };
    sync();
    win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const button =
    "grid h-8 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Window">
      <button type="button" aria-label="Minimize" className={button} onClick={() => void getCurrentWindow().minimize()}>
        <MinusIcon aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className={button}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? (
          <CopySimpleIcon aria-hidden="true" className="size-3.5 -scale-x-100" />
        ) : (
          <SquareIcon aria-hidden="true" className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={cn(button, "hover:bg-status-risk hover:text-primary-foreground")}
        onClick={() => void getCurrentWindow().close()}
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
