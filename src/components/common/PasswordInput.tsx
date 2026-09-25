import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

/**
 * Master-password field. Browser helpers are switched off: no autocomplete,
 * spellcheck, autocorrect or capitalisation, so nothing typed here is kept or
 * sent to a dictionary service. (WebView2 password saving is also disabled in Rust.)
 * The value lives only in the owning component's state.
 */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeSlashIcon : EyeIcon;
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn("h-9 pr-10 font-mono tracking-wide", className)}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => {
          setVisible((v) => !v);
        }}
        className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:opacity-50"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
