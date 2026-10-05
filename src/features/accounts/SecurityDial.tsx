import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS, StatusBadge } from "@/components/common/StatusBadge";
import { FixLink } from "@/features/health/FixLink";
import { cn } from "@/lib/utils";
import type { SecurityScoreResult } from "./securityScore";

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

/** Full ring. Ticks start at 12 o'clock and run clockwise. */
const TICKS = 56;
const RING = 188;
const RING_C = RING / 2;
const TICK_INNER = 66;
const TICK_OUTER = 86;

const TICK_LINES = Array.from({ length: TICKS }, (_, i) => {
  const angle = -Math.PI / 2 + (i / TICKS) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x1: RING_C + cos * TICK_INNER,
    y1: RING_C + sin * TICK_INNER,
    x2: RING_C + cos * TICK_OUTER,
    y2: RING_C + sin * TICK_OUTER,
  };
});

/** Upper semicircle, left to right through 12 o'clock. */
const CAPSULES = 18;
const ARC_W = 188;
const ARC_H = 104;
const ARC_CX = ARC_W / 2;
const ARC_CY = 92;
const CAP_THICK = 8;
const CAP_LEN = 18;
const CAP_R = 72;
const CAP_INSET = 0.16;

const CAPSULE_MARKS = Array.from({ length: CAPSULES }, (_, i) => {
  const t = i / (CAPSULES - 1);
  const theta = Math.PI + CAP_INSET + t * (Math.PI - 2 * CAP_INSET);
  return {
    x: ARC_CX + Math.cos(theta) * CAP_R,
    y: ARC_CY + Math.sin(theta) * CAP_R,
    rotate: (theta * 180) / Math.PI - 90,
  };
});

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Marks lit for a 0–1 sweep. Any score above zero lights at least one. */
function filledCount(fill: number, total: number): number {
  if (fill <= 0) return 0;
  return Math.min(total, Math.max(1, Math.round(fill * total)));
}

/** 0–1 sweep. Starts empty, then moves from the current fill when the score changes. */
function useFill(score: number | null): number {
  const target = score === null ? 0 : score / 100;
  const [fill, setFill] = useState(0);
  const fillRef = useRef(0);

  useEffect(() => {
    const from = fillRef.current;
    let frame = 0;
    if (prefersReducedMotion() || from === target) {
      fillRef.current = target;
      frame = requestAnimationFrame(() => {
        setFill(target);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 200);
      const eased = 1 - (1 - t) ** 3;
      const next = from + (target - from) * eased;
      fillRef.current = next;
      setFill(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target]);

  return fill;
}

function ScoreReadout({ result }: { result: SecurityScoreResult }) {
  const Icon = STATUS[result.status].icon;
  return (
    <div className="flex flex-col items-center gap-1">
      {result.score !== null && (
        <span className="font-mono text-[22px] leading-none tabular-nums">{result.score}</span>
      )}
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", TONE[result.status])}>
        <Icon aria-hidden="true" weight="bold" className="size-3.5 shrink-0" />
        {result.label}
      </p>
    </div>
  );
}

function Preview({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2" aria-hidden="true">
      <p className="text-xs text-subtle-foreground">{caption}</p>
      {children}
    </div>
  );
}

function TickRing({ result, fill }: { result: SecurityScoreResult; fill: number }) {
  const filled = filledCount(fill, TICKS);
  return (
    <div className="relative size-[188px]">
      <svg viewBox={`0 0 ${RING} ${RING}`} className="size-full overflow-visible">
        {TICK_LINES.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            strokeWidth={2}
            strokeLinecap="round"
            className={i < filled ? cn("stroke-current", TONE[result.status]) : "stroke-border-strong"}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <ScoreReadout result={result} />
      </div>
    </div>
  );
}

function SegmentedArc({ result, fill }: { result: SecurityScoreResult; fill: number }) {
  const filled = filledCount(fill, CAPSULES);
  return (
    <div className="relative h-[104px] w-[188px]">
      <svg viewBox={`0 0 ${ARC_W} ${ARC_H}`} className="size-full overflow-visible">
        {CAPSULE_MARKS.map((mark, i) => (
          <g key={i} transform={`translate(${mark.x} ${mark.y}) rotate(${mark.rotate})`}>
            <rect
              x={-CAP_THICK / 2}
              y={-CAP_LEN / 2}
              width={CAP_THICK}
              height={CAP_LEN}
              rx={CAP_THICK / 2}
              className={i < filled ? cn("fill-current", TONE[result.status]) : "fill-border-strong"}
            />
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <ScoreReadout result={result} />
      </div>
    </div>
  );
}

/** Two score charts for comparison, then the facts that produced the score. */
export function SecurityDial({ result }: { result: SecurityScoreResult }) {
  const fill = useFill(result.score);
  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only">
        {result.score === null
          ? `Security score, ${result.label}`
          : `Security score ${result.score} out of 100, ${result.label}`}
      </p>
      <div className="flex flex-wrap items-start gap-8">
        <Preview caption="Tick ring">
          <TickRing result={result} fill={fill} />
        </Preview>
        <Preview caption="Segmented arc">
          <SegmentedArc result={result} fill={fill} />
        </Preview>
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
