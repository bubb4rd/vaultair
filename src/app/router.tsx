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
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { GeneratorPanel } from "@/features/generator/GeneratorPanel";
import { RelationshipMap } from "@/features/graph/RelationshipMap";
import { HealthPage } from "@/features/health/HealthPage";
import { IdentitiesPage } from "@/features/identities/IdentitiesPage";
import { IdentityDetailPage } from "@/features/identities/IdentityDetailPage";
import { IdentityForm } from "@/features/identities/IdentityForm";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppLayout } from "@/features/shell/AppLayout";
import { RoutePage } from "@/features/shell/RoutePage";
import { ALL_NAV_ITEMS } from "./nav";

const rootRoute = createRootRoute({ component: AppLayout });

/** Destinations whose feature has landed. The rest show a placeholder `RoutePage`. */
const PAGES: Record<string, () => React.JSX.Element> = {
  "/": DashboardPage,
  "/accounts": () => <AccountsPage />,
  "/identities": IdentitiesPage,
  "/archived": () => <AccountsPage archived />,
  "/generator": GeneratorPanel,
  "/health": HealthPage,
  "/map": RelationshipMap,
  "/settings": SettingsPage,
  "/games": () => <CatalogPage kind="game" />,
  "/platforms": () => <CatalogPage kind="platform" />,
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

const newIdentityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identities/new",
  component: () => <IdentityForm />,
});

const identityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identities/$identityId",
  component: function IdentityRoute() {
    const { identityId } = identityRoute.useParams();
    return <IdentityDetailPage key={identityId} identityId={identityId} />;
  },
});

const editIdentityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identities/$identityId/edit",
  component: function EditIdentityRoute() {
    const { identityId } = editIdentityRoute.useParams();
    return <IdentityForm key={identityId} identityId={identityId} />;
  },
});

const routeTree = rootRoute.addChildren([
  ...pageRoutes,
  newAccountRoute,
  accountRoute,
  editAccountRoute,
  newIdentityRoute,
  identityRoute,
  editIdentityRoute,
]);

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
