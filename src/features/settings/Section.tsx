import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";

/** One Settings section: a heading the section is labelled by, then its rows. */
export function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`} className="text-[13px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled switch with one line of help under the label. */
export function SwitchRow({
  id,
  label,
  help,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <p id={`${id}-help`} className="text-[13px] text-muted-foreground">
          {help}
        </p>
      </div>
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
