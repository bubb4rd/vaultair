import { FunnelSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountFilter } from "@/ipc/client";
import { FILTER_KINDS, activeChips, withoutChips, type FilterContext, type FilterKind } from "./filters";

/** A kind's options as checkable items. A multi-select stays open to tick more. */
function KindOptions({
  kind,
  filter,
  ctx,
  onChange,
}: {
  kind: FilterKind;
  filter: AccountFilter;
  ctx: FilterContext;
  onChange: (filter: AccountFilter) => void;
}) {
  const selected = kind.selected(filter);
  return (
    <>
      {kind.options(ctx).map((o) => (
        <DropdownMenuCheckboxItem
          key={o.value}
          checked={selected.includes(o.value)}
          className="text-[13px]"
          onSelect={(e) => {
            if (kind.multi) e.preventDefault();
          }}
          onCheckedChange={(on) => {
            const next = kind.multi
              ? on
                ? [...selected, o.value]
                : selected.filter((v) => v !== o.value)
              : on
                ? [o.value]
                : [];
            onChange(kind.set(filter, next));
          }}
        >
          {o.label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

/**
 * "Add filter" and a chip for each filter in use. A chip opens its options
 * to change them and has its own remove button. Every change goes through
 * the kind's `set`, so what's shown is exactly what Rust is asked for.
 */
export function FilterChips({
  filter,
  ctx,
  onChange,
}: {
  filter: AccountFilter;
  ctx: FilterContext;
  onChange: (filter: AccountFilter) => void;
}) {
  const chips = activeChips(filter, ctx);
  const inUse = new Set(chips.map((c) => c.kind.id));
  const available = FILTER_KINDS.filter((k) => !inUse.has(k.id) && k.options(ctx).length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
      {chips.map((chip) => (
        <div
          key={chip.kind.id}
          className="flex h-7 items-center rounded-md border border-border-strong bg-muted/50 text-[12px] text-foreground"
        >
          {chip.kind.flag ? (
            <span className="max-w-64 truncate pr-1 pl-2.5">{chip.text}</span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Change filter: ${chip.text}`}
                  className="h-full max-w-64 cursor-pointer truncate rounded-l-md pr-1 pl-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {chip.text}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 min-w-44">
                <DropdownMenuLabel className="text-xs text-subtle-foreground">{chip.kind.label}</DropdownMenuLabel>
                <KindOptions kind={chip.kind} filter={filter} ctx={ctx} onChange={onChange} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            aria-label={`Remove filter: ${chip.text}`}
            className="grid h-full w-6 cursor-pointer place-items-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onChange(chip.kind.set(filter, []));
            }}
          >
            <XIcon aria-hidden="true" className="size-3" weight="bold" />
          </button>
        </div>
      ))}

      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 border-dashed text-muted-foreground">
              <FunnelSimpleIcon aria-hidden="true" />
              Add filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {available.map((kind) =>
              kind.flag ? (
                <DropdownMenuCheckboxItem
                  key={kind.id}
                  checked={false}
                  className="text-[13px]"
                  onCheckedChange={() => {
                    onChange(kind.set(filter, ["on"]));
                  }}
                >
                  {kind.label}
                </DropdownMenuCheckboxItem>
              ) : (
                <DropdownMenuSub key={kind.id}>
                  <DropdownMenuSubTrigger className="text-[13px]">{kind.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 min-w-44 overflow-y-auto">
                    <KindOptions kind={kind} filter={filter} ctx={ctx} onChange={onChange} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {chips.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => {
            onChange(withoutChips(filter));
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
