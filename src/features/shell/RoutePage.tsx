import { useEffect, useState } from "react";
import type { NavItem } from "@/app/nav";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge, type Status } from "@/components/common/StatusBadge";
import { DevPanel } from "@/features/settings/DevPanel";
import { appInfo, type AppInfo } from "@/ipc/client";
import { PageHeader } from "./PageHeader";

const HEALTH_LEGEND: { status: Status; meaning: string }[] = [
  { status: "secure", meaning: "Strong, unique password with MFA and recovery in place." },
  { status: "attention", meaning: "Something is missing, such as recovery codes." },
  { status: "warning", meaning: "A weak or old password, or MFA turned off." },
  { status: "risk", meaning: "A reused password or no way to recover the account." },
  { status: "dormant", meaning: "Not used for a long time." },
  { status: "linked", meaning: "Connected to another account or identity." },
];

function HealthLegend() {
  return (
    <dl className="mt-2 grid w-full grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
      {HEALTH_LEGEND.map(({ status, meaning }) => (
        <div key={status} className="contents">
          <dt>
            <StatusBadge status={status} />
          </dt>
          <dd className="text-[13px] text-muted-foreground">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

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
          {item.path === "/health" && <HealthLegend />}
          {item.path === "/settings" && <AppVersion />}
          {item.path === "/settings" && import.meta.env.DEV && <DevPanel />}
        </EmptyState>
      </div>
    </>
  );
}
