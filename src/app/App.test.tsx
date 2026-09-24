import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { App } from "./App";

describe("App shell", () => {
  it("renders the titlebar and app info from IPC", async () => {
    mockWindows("main");
    mockIPC((cmd) => {
      if (cmd === "app_info") return { name: "Vaultair", version: "0.1.0", buildProfile: "debug" };
      throw new Error(`unexpected command ${cmd}`);
    });

    render(<App />);

    expect(screen.getByRole("heading", { name: "Vaultair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(await screen.findByTestId("app-version")).toHaveTextContent("v0.1.0 · debug");
  });

  it("still renders when app_info fails", () => {
    mockWindows("main");
    mockIPC(() => {
      throw new Error("boom");
    });

    render(<App />);
    expect(screen.getByRole("heading", { name: "Vaultair" })).toBeInTheDocument();
    expect(screen.queryByTestId("app-version")).not.toBeInTheDocument();
  });
});
