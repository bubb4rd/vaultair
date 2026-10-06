import { useEffect, useRef, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  type IconProps,
} from "@phosphor-icons/react";
import { queryKeys, usePurposes, usePurposesChanged } from "@/app/queries";
import { PurposeDot } from "@/components/common/PurposeBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/features/toast/toast";
import { purposes, toIpcError, type PurposeView } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { DeletePurposeDialog, PurposeDialog, accountsText } from "./PurposeDialogs";

type Open = { kind: "add" } | { kind: "edit"; purpose: PurposeView } | { kind: "delete"; purpose: PurposeView } | null;

function Action({
  id,
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  id?: string;
  label: string;
  icon: ComponentType<IconProps>;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button id={id} type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Settings > Purpose labels: every label in the order forms and filters
 * show them. Built-ins can be hidden, recoloured and moved; labels you add
 * can also be renamed and deleted. Moving is by button, so it works from
 * the keyboard.
 */
export function PurposeLabels() {
  const queryClient = useQueryClient();
  const changed = usePurposesChanged();
  const list = usePurposes().data;
  const [open, setOpen] = useState<Open>(null);
  // The button to focus once a move has re-rendered the list.
  const focusAfterMove = useRef<string | null>(null);
  const moveTicket = useRef(0);

  useEffect(() => {
    if (!focusAfterMove.current) return;
    document.getElementById(focusAfterMove.current)?.focus();
    focusAfterMove.current = null;
  });

  // Nothing to show while loading, or if the list failed.
  if (!list) return null;
  const labels = list;
  const visible = labels.filter((p) => !p.isHidden).length;

  function move(index: number, by: -1 | 1) {
    const item = labels[index];
    const to = index + by;
    if (!item || to < 0 || to >= labels.length) return;
    const next = [...labels];
    next.splice(index, 1);
    next.splice(to, 0, item);
    // At either end the arrow just used is disabled, so focus the other one.
    const edge = to === 0 ? "down" : to === next.length - 1 ? "up" : by < 0 ? "up" : "down";
    focusAfterMove.current = `purpose-${item.id}-${edge}`;
    queryClient.setQueryData<PurposeView[]>(queryKeys.purposes, next);
    const mine = ++moveTicket.current;
    purposes
      .reorder(next.map((p) => p.id))
      .then((saved) => {
        if (mine === moveTicket.current) queryClient.setQueryData<PurposeView[]>(queryKeys.purposes, saved);
      })
      .catch((err: unknown) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.purposes });
        toast.error("Couldn't move the label", { description: toIpcError(err).message });
      });
  }

  async function toggleHidden(p: PurposeView) {
    try {
      await purposes.setHidden(p.id, !p.isHidden);
      changed();
      toast.success(p.isHidden ? "Label shown" : "Label hidden", { description: p.name });
    } catch (err) {
      const ipc = toIpcError(err);
      if (ipc.field === "lastVisible") {
        toast.error("Keep at least one label visible", { description: "New accounts need a purpose to pick." });
      } else {
        toast.error("Couldn't change the label", { description: ipc.message });
      }
    }
  }

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <section aria-labelledby="purposes-heading" className="flex flex-col gap-4">
      <h2 id="purposes-heading" className="text-[13px] font-semibold">
        Purpose labels
      </h2>
      <p className="text-[13px] text-muted-foreground">
        Every account has a purpose. Hiding a label stops it being offered for new accounts; accounts that have it keep
        it. Built-in labels can&apos;t be renamed or deleted.
      </p>
      <ul aria-labelledby="purposes-heading" className="divide-y divide-border rounded-lg border border-border-strong bg-card">
        {labels.map((p, i) => {
          const meta = [p.isBuiltin ? "Built-in" : "Custom", p.isHidden ? "Hidden" : null, accountsText(p.accountCount)];
          return (
            <li key={p.id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3" data-testid="purpose-row">
              <PurposeDot color={p.color} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[13px] font-medium", p.isHidden && "text-muted-foreground")}>
                  {p.name}
                </p>
                <p className="text-xs text-subtle-foreground">{meta.filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Action
                  id={`purpose-${p.id}-up`}
                  label={`Move ${p.name} up`}
                  icon={ArrowUpIcon}
                  disabled={i === 0}
                  onClick={() => {
                    move(i, -1);
                  }}
                />
                <Action
                  id={`purpose-${p.id}-down`}
                  label={`Move ${p.name} down`}
                  icon={ArrowDownIcon}
                  disabled={i === labels.length - 1}
                  onClick={() => {
                    move(i, 1);
                  }}
                />
                <Action
                  label={`Edit ${p.name}`}
                  icon={PencilSimpleIcon}
                  onClick={() => {
                    setOpen({ kind: "edit", purpose: p });
                  }}
                />
                <Action
                  label={p.isHidden ? `Show ${p.name}` : `Hide ${p.name}`}
                  icon={p.isHidden ? EyeIcon : EyeSlashIcon}
                  disabled={!p.isHidden && visible === 1}
                  onClick={() => void toggleHidden(p)}
                />
                {!p.isBuiltin && (
                  <Action
                    label={`Delete ${p.name}`}
                    icon={TrashIcon}
                    onClick={() => {
                      setOpen({ kind: "delete", purpose: p });
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {visible === 1 && (
        <p className="text-[13px] text-muted-foreground">One label stays visible, so new accounts always have a purpose.</p>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen({ kind: "add" });
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add a label
        </Button>
      </div>
      {open?.kind === "add" && <PurposeDialog purpose={null} open onOpenChange={close} />}
      {open?.kind === "edit" && <PurposeDialog key={open.purpose.id} purpose={open.purpose} open onOpenChange={close} />}
      {open?.kind === "delete" && <DeletePurposeDialog purpose={open.purpose} open onOpenChange={close} />}
    </section>
  );
}
