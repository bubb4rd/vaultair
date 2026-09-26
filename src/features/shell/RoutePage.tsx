import { useEffect, useState } from "react";
import type { NavItem } from "@/app/nav";
import { EmptyState } from "@/components/common/EmptyState";
import { DevPanel } from "@/features/settings/DevPanel";
import { appInfo, type AppInfo } from "@/ipc/client";
import { PageHeader } from "./PageHeader";

function AppVersion() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    appInfo()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!info) return null;
  return (
    <p data-testid="app-version" className="font-mono text-xs text-subtle-foreground">
      {info.name} {info.version}
    </p>
  );
}

/** Placeholder page for a sidebar destination until its feature phase lands. */
export function RoutePage({ item }: { item: NavItem }) {
  const empty = item.empty ?? { title: item.label, description: "" };
  return (
    <>
      <PageHeader title={item.label} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <EmptyState icon={item.icon} title={empty.title} description={empty.description}>
          {item.path === "/settings" && <AppVersion />}
          {item.path === "/settings" && import.meta.env.DEV && <DevPanel />}
        </EmptyState>
      </div>
    </>
  );
}
