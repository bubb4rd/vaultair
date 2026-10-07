import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SegmentedGroup, SegmentedItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { copyToClipboard } from "@/features/clipboard/copy";
import { useProtectedCopy } from "@/features/clipboard/protectedCopy";
import { StrengthSegments, strengthLabel } from "@/features/onboarding/StrengthMeter";
import type { Generated } from "@/ipc/client";
import { cn } from "@/lib/utils";
import type { GeneratorMode } from "./useGenerator";

export const KIND_LABEL: Record<GeneratorMode, string> = { password: "Password", passphrase: "Passphrase" };

export function ModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: GeneratorMode;
  onChange: (mode: GeneratorMode) => void;
  className?: string;
}) {
  return (
    <SegmentedGroup
      aria-label="Generate a"
      value={mode}
      onValueChange={(v) => {
        onChange(v as GeneratorMode);
      }}
      className={className}
    >
      <SegmentedItem value="password">Password</SegmentedItem>
      <SegmentedItem value="passphrase">Passphrase</SegmentedItem>
    </SegmentedGroup>
  );
}

/**
 * The value in mono, digits and symbols in the accent so they're easy to
 * tell from letters when typing it by hand. Wraps anywhere: 128 characters
 * have no word breaks. Copying it by hand goes through Rust like the Copy
 * button: kept out of clipboard history and cleared.
 */
export function GeneratedValue({
  value,
  label,
  className,
}: {
  value: string | null;
  /** What the copy toast calls it: "Password" or "Passphrase". */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useProtectedCopy(ref, value ? () => void copyToClipboard(value, label) : null);
  return (
    <p
      ref={ref}
      data-testid="generated-value"
      className={cn("font-mono text-[17px] leading-7 break-all text-foreground", className)}
    >
      {value
        ? Array.from(value, (c, i) => (
            <span key={i} className={/[^A-Za-z ]/.test(c) ? "text-brand" : undefined}>
              {c}
            </span>
          ))
        : " "}
    </p>
  );
}

/** Segments, text label and entropy. The label carries the meaning; color only reinforces it. */
export function StrengthRow({ result, kind }: { result: Generated | null; kind: GeneratorMode }) {
  const bits = result?.entropyBits;
  const label = result ? strengthLabel(result.score) : null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <StrengthSegments score={result?.score ?? null} className="w-24 shrink-0" />
      <span data-testid="strength-label" className="text-[13px] text-foreground">
        {label ?? " "}
      </span>
      {bits != null && (
        <span className="font-mono text-xs text-subtle-foreground" title="Entropy: how many guesses it takes, as a power of two">
          {Math.round(bits)} bits
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {label ? `New ${KIND_LABEL[kind].toLowerCase()} generated. ${label}.` : ""}
      </span>
    </div>
  );
}

/** A count (length, words) as a slider plus a number field that stay in sync. */
export function CountControl({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  // What's typed while editing; null shows the current value (e.g. after a slider move).
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? String(value)}
          autoComplete="off"
          className="h-7 w-16 px-2 text-right font-mono text-[13px] md:text-[13px]"
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={() => {
            setDraft(null);
          }}
        />
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => {
          if (v !== undefined) onChange(v);
        }}
        thumbProps={{ "aria-label": label }}
      />
    </div>
  );
}
