import { getCurrentWindow } from "@tauri-apps/api/window";

// Custom titlebar (the native frame is disabled). The drag region is the bar itself;
// buttons opt out of dragging because they are interactive elements.
export function Titlebar() {
  const win = () => getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        Vaultair
      </span>
      <div className="titlebar-controls">
        <button type="button" aria-label="Minimize" onClick={() => void win().minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" />
          </svg>
        </button>
        <button type="button" aria-label="Maximize" onClick={() => void win().toggleMaximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          className="titlebar-close"
          onClick={() => void win().close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  );
}
