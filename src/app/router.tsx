import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { AccountDetailPage } from "@/features/accounts/AccountDetailPage";
import { AccountForm } from "@/features/accounts/AccountForm";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { GeneratorPanel } from "@/features/generator/GeneratorPanel";
import { AppLayout } from "@/features/shell/AppLayout";
import { RoutePage } from "@/features/shell/RoutePage";
import { ALL_NAV_ITEMS } from "./nav";

const rootRoute = createRootRoute({ component: AppLayout });

/** Destinations whose feature has landed. The rest show a placeholder `RoutePage`. */
const PAGES: Record<string, () => React.JSX.Element> = {
  "/accounts": () => <AccountsPage />,
  "/archived": () => <AccountsPage archived />,
  "/generator": GeneratorPanel,
};

const pageRoutes = ALL_NAV_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: PAGES[item.path] ?? (() => <RoutePage item={item} />),
  }),
);

const newAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/new",
  component: () => <AccountForm />,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId",
  component: function AccountRoute() {
    const { accountId } = accountRoute.useParams();
    // Keyed so switching accounts (a sidebar favorite) starts fresh: no
    // revealed value carries over from the previous account.
    return <AccountDetailPage key={accountId} accountId={accountId} />;
  },
});

const editAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId/edit",
  component: function EditAccountRoute() {
    const { accountId } = editAccountRoute.useParams();
    return <AccountForm key={accountId} accountId={accountId} />;
  },
});

const routeTree = rootRoute.addChildren([...pageRoutes, newAccountRoute, accountRoute, editAccountRoute]);

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
