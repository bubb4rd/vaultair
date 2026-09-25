import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * A radio group drawn as a segmented control: one row of equal buttons,
 * arrow keys move the selection. Same look as the default `TabsList`.
 */
function SegmentedGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-group"
      orientation="horizontal"
      className={cn("inline-flex h-8 w-fit items-center rounded-lg bg-muted p-[3px]", className)}
      {...props}
    />
  )
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="segmented-item"
      className={cn(
        "inline-flex h-full min-w-8 flex-1 items-center justify-center rounded-md border border-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "data-[state=checked]:border-input data-[state=checked]:bg-input/30 data-[state=checked]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { SegmentedGroup, SegmentedItem }
