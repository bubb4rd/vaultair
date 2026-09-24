import { useEffect, useId, useRef, type ReactNode, type SubmitEvent } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepPageProps {
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
  /** Primary button label. Omit for steps that advance on their own. */
  primary?: string;
  onSubmit?: () => void | Promise<void>;
  onBack?: () => void;
  /** Extra buttons after the primary one (e.g. "Skip"). */
  secondary?: ReactNode;
  busy?: boolean;
  /** Shown above the title, e.g. the success mark on "Your vault is ready". */
  leading?: ReactNode;
}

/*
 * Enter choreography (the screen itself slides in, see Onboarding): heading
 * first, then the content, then the actions, 60 ms apart. `fill-mode-both`
 * keeps later parts hidden until their turn. Reduced motion removes all of it.
 */
const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out fill-mode-both";

/**
 * One onboarding screen: optional Back link, heading, intro, content, actions.
 * The heading takes focus when the screen appears, so screen readers announce
 * the new step and Tab starts from the top of it.
 */
export function StepPage({ title, intro, children, primary, onSubmit, onBack, secondary, busy, leading }: StepPageProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!busy) void onSubmit?.();
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={titleId} className="flex flex-col gap-8">
      <div className={cn("flex flex-col items-start gap-3", ENTER)}>
        {onBack && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2.5 text-subtle-foreground">
            <ArrowLeftIcon aria-hidden="true" />
            Back
          </Button>
        )}
        {leading}
        <h1
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-[-0.02em] text-balance outline-none"
        >
          {title}
        </h1>
        {intro && <div className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{intro}</div>}
      </div>
      {children && <div className={cn("flex flex-col gap-8 delay-[60ms]", ENTER)}>{children}</div>}
      {(primary ?? secondary) && (
        <div className={cn("flex items-center gap-2 delay-[120ms]", ENTER)}>
          {primary && (
            <Button type="submit" size="lg" disabled={busy}>
              {primary}
            </Button>
          )}
          {secondary}
        </div>
      )}
    </form>
  );
}
