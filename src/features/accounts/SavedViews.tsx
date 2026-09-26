import { createElement, useState, type SubmitEvent } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  BookmarkSimpleIcon,
  CaretDownIcon,
  ClockIcon,
  CrownSimpleIcon,
  EnvelopeSimpleIcon,
  FlagIcon,
  KeyIcon,
  LifebuoyIcon,
  MoonIcon,
  ShieldSlashIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/app/queries";
import { Field, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/features/toast/toast";
import { search, toIpcError, type SavedView, type ViewSpec } from "@/ipc/client";
import { ARCHIVED_VIEW_ID } from "./listState";

/** Glyphs for the icon names built-in views are seeded with (migration V7). */
const ICONS: Record<string, Icon> = {
  crown: CrownSimpleIcon,
  users: UsersIcon,
  flag: FlagIcon,
  shield: ShieldSlashIcon,
  lifebuoy: LifebuoyIcon,
  envelope: EnvelopeSimpleIcon,
  clock: ClockIcon,
  moon: MoonIcon,
  archive: ArchiveIcon,
};

/** `null` is "All accounts". User views share the bookmark glyph. */
export function viewIcon(view: SavedView | null): Icon {
  if (!view) return KeyIcon;
  return (view.icon ? ICONS[view.icon] : undefined) ?? BookmarkSimpleIcon;
}

/** A view's glyph, decorative (the view's name is always next to it). */
export function ViewGlyph({ view, className }: { view: SavedView | null; className?: string | undefined }) {
  return createElement(viewIcon(view), { "aria-hidden": true, className });
}

/** Names a new view, or renames one. Rust checks the name is free. */
function NameDialog({
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the view a name.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      const e = toIpcError(err);
      setError(e.field === "name" ? "Another view already has this name." : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{title}</DialogTitle>
            <DialogDescription className="text-[13px]">
              A view keeps these filters and this sort order, to open again from the Views menu or Ctrl+K.
            </DialogDescription>
          </DialogHeader>
          <Field id="view-name" label="Name" error={error}>
            <Input
              id="view-name"
              value={name}
              maxLength={60}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("view-name", { error: Boolean(error) })}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Views menu: all accounts, the built-in views, the user's views, and
 * saving what's on screen as a view. Archived isn't listed: it has its own
 * sidebar entry.
 */
export function ViewMenu({
  views,
  current,
  spec,
  edited,
  onOpen,
  onSaved,
}: {
  views: SavedView[];
  /** The view the list started from, if any. */
  current: SavedView | null;
  /** What's on screen now. */
  spec: ViewSpec;
  /** What's on screen differs from `current` (or from no filter at all). */
  edited: boolean;
  onOpen: (view: SavedView | null) => void;
  /** A view now stores what's on screen (created, or saved over). */
  onSaved: (view: SavedView) => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"save" | "rename" | null>(null);
  const builtins = views.filter((v) => v.isBuiltin && v.id !== ARCHIVED_VIEW_ID);
  const mine = views.filter((v) => !v.isBuiltin);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.savedViews });
  const close = () => {
    setDialog(null);
  };

  async function saveChanges(view: SavedView) {
    try {
      const saved = await search.updateView(view.id, { name: view.name, spec });
      await refresh();
      onSaved(saved);
      toast.success("View saved", { description: saved.name });
    } catch (err) {
      toast.error("Couldn't save the view", { description: toIpcError(err).message });
    }
  }

  async function remove(view: SavedView) {
    try {
      await search.deleteView(view.id);
      await refresh();
      onOpen(null);
      toast.success("View deleted", { description: view.name });
    } catch (err) {
      toast.error("Couldn't delete the view", { description: toIpcError(err).message });
    }
  }

  const item = (view: SavedView | null) => {
    const selected = (view?.id ?? null) === (current?.id ?? null);
    return (
      <DropdownMenuItem
        key={view?.id ?? "all"}
        className="text-[13px]"
        aria-current={selected ? "true" : undefined}
        onSelect={() => {
          onOpen(view);
        }}
      >
        <ViewGlyph view={view} className={selected ? "text-brand" : undefined} />
        {view?.name ?? "All accounts"}
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-7 max-w-64" aria-label="Views">
            <ViewGlyph view={current} className="text-brand" />
            <span className="truncate">{current?.name ?? "All accounts"}</span>
            {edited && current && <span className="text-xs font-normal text-subtle-foreground">edited</span>}
            <CaretDownIcon aria-hidden="true" className="size-3 text-subtle-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 min-w-56">
          {item(null)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-subtle-foreground">Built-in views</DropdownMenuLabel>
          {builtins.map(item)}
          {mine.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-subtle-foreground">Your views</DropdownMenuLabel>
              {mine.map(item)}
            </>
          )}
          <DropdownMenuSeparator />
          {current && !current.isBuiltin && edited && (
            <DropdownMenuItem className="text-[13px]" onSelect={() => void saveChanges(current)}>
              Save changes to “{current.name}”
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-[13px]"
            disabled={!edited}
            onSelect={() => {
              setDialog("save");
            }}
          >
            Save as new view…
          </DropdownMenuItem>
          {current && !current.isBuiltin && (
            <>
              <DropdownMenuItem
                className="text-[13px]"
                onSelect={() => {
                  setDialog("rename");
                }}
              >
                Rename “{current.name}”…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" className="text-[13px]" onSelect={() => void remove(current)}>
                Delete “{current.name}”
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "save" && (
        <NameDialog
          title="Save as a view"
          initial=""
          submitLabel="Save view"
          onClose={close}
          onSubmit={async (name) => {
            const saved = await search.createView({ name, spec });
            await refresh();
            onSaved(saved);
            toast.success("View saved", { description: saved.name });
          }}
        />
      )}
      {dialog === "rename" && current && (
        <NameDialog
          title="Rename view"
          initial={current.name}
          submitLabel="Rename"
          onClose={close}
          onSubmit={async (name) => {
            // Renaming keeps the view's stored filter, not unsaved edits.
            await search.updateView(current.id, { name, spec: current.spec });
            await refresh();
          }}
        />
      )}
    </>
  );
}
