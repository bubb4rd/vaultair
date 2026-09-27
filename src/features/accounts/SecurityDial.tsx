import { useEffect, useState } from "react";
import { STATUS, StatusBadge } from "@/components/common/StatusBadge";
import { FixLink } from "@/features/health/FixLink";
import { cn } from "@/lib/utils";
import type { SecurityScoreResult } from "./securityScore";

const WIDTH = 168;
const STROKE = 8;
const RADIUS = 72;
const CX = WIDTH / 2;
const CY = RADIUS + STROKE / 2;
const HEIGHT = CY + STROKE / 2;
/** Upper semicircle, left to right. Clockwise from 9 o'clock passes through 12. */
const ARC = `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}`;
const ARC_LENGTH = Math.PI * RADIUS;

const TONE: Record<SecurityScoreResult["status"], string> = {
  secure: "text-status-secure",
  attention: "text-status-attention",
  warning: "text-status-warning",
  risk: "text-status-risk",
  dormant: "text-status-dormant",
  archived: "text-status-dormant",
  unknown: "text-status-dormant",
  linked: "text-status-linked",
  info: "text-status-linked",
};

/** Semicircular score, then the facts that produced it. */
export function SecurityDial({ result }: { result: SecurityScoreResult }) {
  const score = result.score;
  const [offset, setOffset] = useState(ARC_LENGTH);
  useEffect(() => {
    const next = score === null ? ARC_LENGTH : ARC_LENGTH * (1 - score / 100);
    const frame = requestAnimationFrame(() => {
      setOffset(next);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [score]);

  const Icon = STATUS[result.status].icon;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-[168px] flex-col items-center gap-1">
        <div className="relative h-[80px] w-full">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="size-full overflow-visible" aria-hidden="true">
            <path d={ARC} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-border-strong" />
            {score !== null && (
              <path
                d={ARC}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                style={{ strokeDasharray: ARC_LENGTH, strokeDashoffset: offset }}
                className={cn("stroke-current transition-[stroke-dashoffset] duration-200 ease-out", TONE[result.status])}
              />
            )}
          </svg>
          {score !== null && (
            <p className="absolute inset-x-0 bottom-1 text-center leading-none">
              <span className="sr-only">Security score </span>
              <span className="font-mono text-[22px] tabular-nums">{score}</span>
              <span className="sr-only"> out of 100, </span>
            </p>
          )}
        </div>
        <p className={cn("flex items-center gap-1.5 text-xs font-medium", TONE[result.status])}>
          <Icon aria-hidden="true" weight="bold" className="size-3.5" />
          {score === null && <span className="sr-only">Security score, </span>}
          {result.label}
        </p>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-2">
        {result.chips.map((chip) => (
          <li key={chip.key} className="flex max-w-full flex-wrap items-center gap-2">
            <StatusBadge status={chip.status} label={chip.label} />
            {chip.detail && <span className="text-xs text-subtle-foreground">{chip.detail}</span>}
            {chip.reason && <span className="text-[13px]">{chip.reason}</span>}
            {chip.issue && chip.issue.fix !== "account" && <FixLink issue={chip.issue} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
