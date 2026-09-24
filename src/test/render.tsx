import { render } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { App } from "@/app/App";
import { createAppRouter } from "@/app/router";

/** Renders the whole app at `path` with Tauri IPC mocked. */
export async function renderApp(path = "/") {
  mockWindows("main");
  mockIPC((cmd) => {
    if (cmd === "app_info") return { name: "Vaultair", version: "0.1.0", buildProfile: "debug" };
    if (cmd === "plugin:window|is_maximized") return false;
    if (cmd === "plugin:event|listen") return 1;
    return null;
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App router={router} />);
  await router.load();
  return { ...result, router };
}
