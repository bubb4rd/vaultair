import * as React from "react"
import { CaretDownIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

const control =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"

/** Multi-line input, styled like `Input`. Browser helpers stay off for vault data. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      className={cn(control, "min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  )
}

/**
 * A native `<select>`, styled like `Input`. Native keeps keyboard and screen
 * reader behaviour exactly as Windows users expect, for short fixed lists.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(control, "h-9 appearance-none pr-9 [&>option]:bg-popover", className)}
        {...props}
      >
        {children}
      </select>
      <CaretDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Textarea, NativeSelect }
