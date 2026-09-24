import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppLayout } from "@/features/shell/AppLayout";
import { RoutePage } from "@/features/shell/RoutePage";
import { ALL_NAV_ITEMS } from "./nav";

const rootRoute = createRootRoute({ component: AppLayout });

const pageRoutes = ALL_NAV_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: () => <RoutePage item={item} />,
  }),
);

const routeTree = rootRoute.addChildren(pageRoutes);

/**
 * Hash history: the webview always loads index.html, so reloads (the lock flow
 * reloads the webview) never ask the asset server for a path that doesn't exist.
 */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
