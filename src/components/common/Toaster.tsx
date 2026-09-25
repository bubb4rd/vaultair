import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import { KeyboardHint } from "@/components/common/KeyboardHint";
import { Button } from "@/components/ui/button";
import { toast, useToasts, type ToastKind, type ToastRecord } from "@/features/toast/toast";
import { cn } from "@/lib/utils";

const KIND_ICON = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: WarningIcon,
  info: InfoIcon,
} satisfies Record<ToastKind, unknown>;

const KIND_COLOR: Record<ToastKind, string> = {
  success: "text-status-secure",
  error: "text-status-risk",
  warning: "text-status-warning",
  info: "text-brand",
};

/** Closes the toast after its duration; hovering or focusing it pauses the clock. */
function useAutoDismiss(t: ToastRecord, paused: boolean) {
  const remaining = useRef(t.duration);
  // A replaced toast (new version) gets its full time again.
  useEffect(() => {
    remaining.current = t.duration;
  }, [t.version, t.duration]);
  useEffect(() => {
    if (t.closing || paused || remaining.current === null) return;
    const started = Date.now();
    const handle = window.setTimeout(() => {
      toast.dismiss(t.id);
    }, remaining.current);
    return () => {
      window.clearTimeout(handle);
      if (remaining.current !== null) remaining.current -= Date.now() - started;
    };
  }, [t.id, t.version, t.closing, paused]);
}

/** Whole seconds until `endsAt`, ticking while there is one. */
function useSecondsLeft(endsAt: number | null, totalSecs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (endsAt === null) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [endsAt]);
  if (endsAt === null) return 0;
  // `now` can predate a fresh countdown by up to one tick; never show more than the total.
  return Math.min(totalSecs, Math.max(0, Math.ceil((endsAt - now) / 1000)));
}

/** A ring that drains as the countdown runs, drawn around the icon (macOS-style). */
function CountdownRing({ fraction }: { fraction: number }) {
  const r = 10.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute inset-0 size-full -rotate-90">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2" className="stroke-muted" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        className="stroke-brand transition-[stroke-dashoffset] duration-300 ease-linear"
      />
    </svg>
  );
}

function ToastItem({ toast: t }: { toast: ToastRecord }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useAutoDismiss(t, hovered || focused);
  const secs = useSecondsLeft(t.countdown?.endsAt ?? null, t.countdown?.totalSecs ?? 0);
  const Icon = t.icon ?? KIND_ICON[t.kind];
  const actions = t.actions ?? [];

  return (
    <li
      data-toast-id={t.id}
      data-kind={t.kind}
      data-closing={t.closing || undefined}
      // Rows grow in and collapse out, so the rest of the stack glides instead of jumping.
      className="group grid grid-rows-[1fr] justify-items-center transition-[grid-template-rows] duration-200 ease-out starting:grid-rows-[0fr] data-closing:grid-rows-[0fr]"
    >
      <div className="min-h-0 overflow-y-clip">
        <div className="pb-2">
          <div
            data-slot="toast"
            onPointerEnter={() => {
              setHovered(true);
            }}
            onPointerLeave={() => {
              setHovered(false);
            }}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
            }}
            className={cn(
              // A horizontal capsule: fully round ends at one line (44 px tall, 22 px radius).
              "pointer-events-auto flex min-h-11 max-w-[min(720px,calc(100vw-2rem))] items-center gap-3 rounded-[22px] border py-1.5 pr-1.5 pl-2 text-popover-foreground",
              "bg-popover/95 backdrop-blur-md",
              t.kind === "error" ? "border-status-risk/45" : "border-border-strong",
              // Enter: drop in from above and settle. Exit: lift away and fade.
              "origin-top transition-[opacity,translate,scale] duration-200 ease-out",
              "starting:-translate-y-3 starting:scale-95 starting:opacity-0",
              "group-data-closing:-translate-y-2 group-data-closing:scale-95 group-data-closing:opacity-0",
            )}
          >
            <span className="relative grid size-7 shrink-0 place-items-center">
              {t.countdown && <CountdownRing fraction={secs / Math.max(1, t.countdown.totalSecs)} />}
              <Icon weight="fill" aria-hidden className={cn("size-4", KIND_COLOR[t.kind])} />
            </span>
            <p className="min-w-0 py-1 text-[13px] leading-5">
              <span className="font-medium text-foreground">{t.title}</span>
              {t.description && <span className="text-muted-foreground"> · {t.description}</span>}
              {t.shortcut && <KeyboardHint keys={t.shortcut} className="ml-1.5 align-[-3px]" />}
            </p>
            {t.countdown && (
              // The ring shows the countdown; the number is a compact readout next to it.
              <span aria-hidden className="w-7 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {secs}s
              </span>
            )}
            {actions.length > 0 && (
              <div className="flex shrink-0 items-center gap-1">
                {actions.map((a, i) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={i === actions.length - 1 ? "outline" : "ghost"}
                    className="rounded-full"
                    onClick={a.onClick}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss notification"
              className="shrink-0 rounded-full"
              onClick={() => {
                toast.dismiss(t.id);
              }}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Renders every toast as a capsule at the top center of the window, newest
 * first. Mounted once at the app root so the lock screen and onboarding can
 * use it too. Screen readers get each toast once through the live regions
 * (errors assertively); the countdown ticks are not announced.
 */
export function Toaster() {
  const { toasts, announcement } = useToasts();
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
    >
      {/* Plain live regions (no role), so they never collide with a page's own alert or status. */}
      <div data-toast-live="polite" aria-live="polite" aria-atomic className="sr-only">
        {announcement && !announcement.assertive && <span key={announcement.seq}>{announcement.text}</span>}
      </div>
      <div data-toast-live="assertive" aria-live="assertive" aria-atomic className="sr-only">
        {announcement?.assertive && <span key={announcement.seq}>{announcement.text}</span>}
      </div>
      <ol className="flex flex-col items-center">
        {[...toasts].reverse().map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </ol>
    </section>
  );
}
