import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALL_NAV_ITEMS } from "@/app/nav";
import { renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";

describe("app shell", () => {
  it.each(ALL_NAV_ITEMS.map((i) => [i.path, i] as const))("%s renders its header", async (path, item) => {
    await renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: item.label })).toBeInTheDocument();
    if (item.empty) {
      const empty = screen.getByTestId("empty-state");
      expect(within(empty).getByRole("heading", { name: item.empty.title })).toBeInTheDocument();
    }
  });

  it("has no title bar: window controls live in the page header", async () => {
    await renderApp("/");
    const header = (await screen.findByRole("heading", { level: 1 })).closest("header");
    expect(header).toHaveAttribute("data-tauri-drag-region");
    const controls = within(header as HTMLElement).getByRole("group", { name: "Window" });
    for (const name of ["Minimize", "Maximize", "Close"]) {
      expect(within(controls).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it("navigates with the sidebar and marks the current page", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("link", { name: "Identities" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Identities" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/identities");
    expect(within(nav).getByRole("link", { name: "Identities" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the command palette with Ctrl+K and navigates from it", async () => {
    const user = userEvent.setup();
    await renderApp("/");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "health");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Security Health" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("every sidebar destination is reachable by keyboard", async () => {
    const user = userEvent.setup();
    await renderApp("/");
    const reached = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await user.tab();
      const el = document.activeElement;
      if (el instanceof HTMLAnchorElement) reached.add(el.textContent);
    }
    for (const item of ALL_NAV_ITEMS) expect(reached).toContain(item.label);
  });

  it("shows the app version in Settings", async () => {
    await renderApp("/settings");
    expect(await screen.findByTestId("app-version")).toHaveTextContent("Vaultair 0.1.0");
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/health");
    await screen.findByRole("heading", { level: 1, name: "Security Health" });
    expect(await axeViolations(container)).toEqual([]);
  });
});
