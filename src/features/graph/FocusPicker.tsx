import { useState } from "react";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface FocusOption {
  /** `<kind>:<id>` of the record. */
  key: string;
  label: string;
}

export interface FocusGroup {
  label: string;
  options: FocusOption[];
}

/**
 * Chooses the record the map is centred on: a button showing the current
 * one, opening a searchable list grouped by kind. Typing matches names only,
 * never ids.
 */
export function FocusPicker({
  groups,
  value,
  onChange,
}: {
  groups: FocusGroup[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = groups.flatMap((g) => g.options).find((o) => o.key === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label="Focus"
          aria-expanded={open}
          className="flex h-7 w-56 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
        >
          <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? "Choose a record"}</span>
          <CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="Choose a focus" className="w-72 overflow-hidden p-0">
        <Command
          label="Find a record"
          defaultValue={value}
          filter={(_, search, keywords) =>
            (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Find a record" className="text-[13px]" />
          <CommandList className="max-h-80">
            <CommandEmpty className="py-6 text-center text-[13px] text-muted-foreground">Nothing matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.options.map((o) => (
                  <CommandItem
                    key={o.key}
                    value={o.key}
                    keywords={[o.label]}
                    className="text-[13px]"
                    onSelect={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.key === value && <CheckIcon aria-hidden="true" className="size-3.5" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
