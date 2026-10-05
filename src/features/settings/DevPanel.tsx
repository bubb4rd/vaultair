import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/features/clipboard/copy";
import { toast } from "@/features/toast/toast";
import { session, type SessionConfig } from "@/ipc/client";

/** Harmless text for trying the clipboard flow; not a real value. */
export const SAMPLE_COPY_TEXT = "vaultair-sample-username";

function duration(secs: number | null) {
  if (secs === null) return "never";
  return secs % 60 === 0 ? `${String(secs / 60)} min` : `${String(secs)}s`;
}

/** One of each kind, for checking the look and motion. */
function previewToasts() {
  toast.success("Account saved", { description: "Changes are encrypted and stored in your vault." });
  toast.info("Search", { description: "Open it anytime with", shortcut: ["Ctrl", "K"] });
  toast.error("Couldn't save", { description: "Something went wrong. Your vault was not changed." });
}

/**
 * Debug builds only (`import.meta.env.DEV`), stripped from release. Tries the
 * clipboard flow and notifications from Settings.
 */
export function DevPanel() {
  const [config, setConfig] = useState<SessionConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    session
      .config()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby="dev-panel-title"
      className="mt-6 w-full rounded-lg border border-dashed border-border-strong p-4 text-left"
    >
      <h2 id="dev-panel-title" className="text-sm font-medium">
        Developer checks
      </h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Debug builds only.</p>
      {config && (
        <p className="mt-3 font-mono text-xs text-subtle-foreground">
          idle lock {duration(config.idleLockSecs)} · clipboard {config.clipboardClearSecs}s · lock on Win+L{" "}
          {config.lockOnSessionLock ? "on" : "off"} · sleep {config.lockOnSleep ? "on" : "off"} · minimize{" "}
          {config.lockOnMinimize ? "on" : "off"} · capture {config.captureMode} · window{" "}
          {config.captureProtection ? "hidden" : "visible"}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void copyToClipboard(SAMPLE_COPY_TEXT, "Sample value")}>
          Copy sample value
        </Button>
        <Button variant="outline" size="sm" onClick={previewToasts}>
          Preview notifications
        </Button>
      </div>
    </section>
  );
}
