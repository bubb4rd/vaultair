import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react";
import type { StrengthEstimate } from "@/ipc/client";
import { cn } from "@/lib/utils";

const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;
const TONES = ["bg-status-risk", "bg-status-risk", "bg-status-warning", "bg-status-secure", "bg-status-secure"];

export function strengthLabel(score: number) {
  return LABELS[Math.min(Math.max(score, 0), 4)] ?? "Very weak";
}

/**
 * Four segments plus a text label: the label carries the meaning, color only
 * reinforces it. The score comes from Rust (zxcvbn), the same check that
 * enforces the policy.
 */
export function StrengthMeter({ estimate, id }: { estimate: StrengthEstimate | null; id: string }) {
  const score = estimate?.score ?? 0;
  const filled = estimate ? Math.max(1, score) : 0;
  const advice = estimate?.warning ?? estimate?.suggestions[0] ?? null;
  return (
    <div id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn("h-1 rounded-full transition-colors", i <= filled ? TONES[score] : "bg-border-strong")}
            />
          ))}
        </div>
        <span className="w-24 text-right text-[13px] text-muted-foreground" aria-live="polite">
          {estimate ? strengthLabel(score) : " "}
        </span>
      </div>
      {advice && <p className="text-[13px] text-muted-foreground">{advice}</p>}
    </div>
  );
}

export function Requirement({ met, children }: { met: boolean; children: string }) {
  const Icon = met ? CheckCircleIcon : CircleIcon;
  return (
    <li className={cn("flex items-center gap-2 text-[13px]", met ? "text-foreground" : "text-muted-foreground")}>
      <Icon
        aria-hidden="true"
        weight={met ? "fill" : "regular"}
        className={cn("size-4 shrink-0", met ? "text-status-secure" : "text-subtle-foreground")}
      />
      {children}
      <span className="sr-only">{met ? "(done)" : "(not yet)"}</span>
    </li>
  );
}
