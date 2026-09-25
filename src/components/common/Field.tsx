import type { ReactNode } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";

/** ids for wiring a control to its label, help and error text. */
export function fieldIds(id: string) {
  return { help: `${id}-help`, error: `${id}-error` };
}

/** `aria-describedby` for a control: error first, so it's read before the help. */
export function describedBy(id: string, opts: { help?: boolean; error?: boolean }) {
  const ids = fieldIds(id);
  return [opts.error && ids.error, opts.help && ids.help].filter(Boolean).join(" ") || undefined;
}

interface FieldProps {
  id: string;
  label: string;
  help?: ReactNode;
  error?: string | null | undefined;
  children: ReactNode;
}

/** Label above the control, help below it, error below that (icon + text). */
export function Field({ id, label, help, error, children }: FieldProps) {
  const ids = fieldIds(id);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {help && (
        <p id={ids.help} className="text-[13px] text-muted-foreground">
          {help}
        </p>
      )}
      {error && <FieldError id={ids.error}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-[13px] text-status-risk animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
