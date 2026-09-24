import { useEffect, useState } from "react";
import { Titlebar } from "./Titlebar";
import { appInfo, type AppInfo } from "../ipc/client";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    appInfo()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch(() => {
        // Shell still renders without version info; errors are surfaced by later phases.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <Titlebar />
      <main className="app-body">
        <h1>Vaultair</h1>
        <p className="muted">Local encrypted vault. Nothing leaves this device.</p>
        {info && (
          <p className="muted small" data-testid="app-version">
            v{info.version} · {info.buildProfile}
          </p>
        )}
      </main>
    </div>
  );
}
