import type { NavItem } from "@/app/nav";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "./PageHeader";

/** Placeholder page for a sidebar destination until its feature phase lands. */
export function RoutePage({ item }: { item: NavItem }) {
  const empty = item.empty ?? { title: item.label, description: "" };
  return (
    <>
      <PageHeader title={item.label} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <EmptyState icon={item.icon} title={empty.title} description={empty.description} />
      </div>
    </>
  );
}
