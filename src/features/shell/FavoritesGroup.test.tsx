import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderApp } from "@/test/render";
import { FavoritesGroup, type FavoriteAccount } from "./FavoritesGroup";

async function renderGroup(items: FavoriteAccount[]) {
  const rootRoute = createRootRoute({ component: () => <FavoritesGroup items={items} /> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() });
  render(<RouterProvider router={router} />);
  await router.load();
}

describe("favorites in the sidebar", () => {
  it("is a sidebar section, not a page", async () => {
    await renderApp("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Favorites" })).not.toBeInTheDocument();
    const group = within(nav).getByRole("group", { name: "Favorites" });
    expect(group).toHaveTextContent("No starred accounts yet");
  });

  it("sits between the Vault and Catalog groups", async () => {
    await renderApp("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(labels).toEqual(["Overview", "Vault", "Favorites", "Catalog", "Insights", "Tools"]);
  });

  it("lists starred accounts in order", async () => {
    await renderGroup([
      { id: "a1", label: "Main (EUW)", detail: "Riot" },
      { id: "a2", label: "Ranked alt", detail: "Steam" },
    ]);
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Main (EUW)Riot", "Ranked altSteam"]);
    expect(screen.queryByText("No starred accounts yet")).not.toBeInTheDocument();
  });
});
