import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { GeneratorPanel } from "@/features/generator/GeneratorPanel";
import { AppLayout } from "@/features/shell/AppLayout";
import { RoutePage } from "@/features/shell/RoutePage";
import { ALL_NAV_ITEMS } from "./nav";

const rootRoute = createRootRoute({ component: AppLayout });

/** Destinations whose feature has landed. The rest show a placeholder `RoutePage`. */
const PAGES: Record<string, () => React.JSX.Element> = {
  "/generator": GeneratorPanel,
};

const pageRoutes = ALL_NAV_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: PAGES[item.path] ?? (() => <RoutePage item={item} />),
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
