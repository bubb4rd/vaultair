import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: Icon;
  title: string;
  description: string;
  /** Optional action or supporting content below the description. */
  children?: ReactNode;
  className?: string;
}

/** Left-aligned, calm empty state: says what will appear here and how it gets there. */
export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <section
      aria-labelledby="empty-state-title"
      data-testid="empty-state"
      className={cn("flex max-w-xl flex-col items-start gap-3 pt-16", className)}
    >
      <div className="grid size-10 place-items-center rounded-lg border border-border-strong bg-card text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <div className="space-y-1">
        <h2 id="empty-state-title" className="text-[15px] font-semibold text-foreground">
          {title}
        </h2>
        <p className="max-w-md text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
