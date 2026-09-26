import { useState, type SubmitEvent } from "react";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ShieldWarningIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useIdentitiesChanged, useTags } from "@/app/queries";
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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/features/toast/toast";
import { accounts, bulkDeletePhrase, toIpcError, type AccountSummary } from "@/ipc/client";

const plural = (n: number) => `${String(n)} ${n === 1 ? "account" : "accounts"}`;

/** Comma-separated tag names, trimmed, without blanks. */
function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Adds tags to the selection, and removes any of the ones it already has. */
function BulkTag({ selected, onDone }: { selected: AccountSummary[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [add, setAdd] = useState("");
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const suggestions = useTags().data ?? [];
  const present = [...new Set(selected.flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b));
  const toAdd = parseTags(add);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (toAdd.length === 0 && remove.length === 0) return;
    setBusy(true);
    try {
      const r = await accounts.bulkTag(
        selected.map((a) => a.id),
        toAdd,
        remove,
      );
      toast.success(`Tags updated on ${plural(r.changed)}`);
      setOpen(false);
      setAdd("");
      setRemove([]);
      onDone();
    } catch (err) {
      const e = toIpcError(err);
      toast.error("Couldn't update tags", {
        description: e.field === "tags" ? "Tags are up to 40 characters, and an account can have up to 32." : e.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <TagIcon aria-hidden="true" />
          Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 bg-popover p-3">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <Field id="bulk-tag-add" label="Add tags" help="Separate tags with commas.">
            <Input
              id="bulk-tag-add"
              value={add}
              list="bulk-tag-suggestions"
              autoComplete="off"
              aria-describedby={describedBy("bulk-tag-add", { help: true })}
              onChange={(e) => {
                setAdd(e.target.value);
              }}
            />
            <datalist id="bulk-tag-suggestions">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          {present.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1.5 text-[13px] font-medium text-foreground">Remove tags</legend>
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                {present.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={remove.includes(t)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setRemove((r) => (on ? [...r, t] : r.filter((x) => x !== t)));
                      }}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Button type="submit" size="sm" disabled={busy || (toAdd.length === 0 && remove.length === 0)}>
            Apply to {plural(selected.length)}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Deleting several accounts at once. The user types "DELETE <n> ACCOUNTS";
 * Rust checks the phrase and the count again, so nothing else can delete
 * in bulk.
 */
export function BulkDeleteDialog({
  ids,
  open,
  onOpenChange,
  onDeleted,
}: {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const phrase = bulkDeletePhrase(ids.length);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === phrase;

  function change(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!matches) {
      setError(`Type ${phrase} exactly as shown.`);
      return;
    }
    setBusy(true);
    try {
      const r = await accounts.bulkDelete(ids, typed);
      change(false);
      toast.success(`${plural(r.changed)} deleted`);
      onDeleted();
    } catch (err) {
      const e = toIpcError(err);
      setError(
        e.field === "confirm"
          ? `Type ${phrase} exactly as shown.`
          : e.code === "not_found"
            ? "Some of these accounts no longer exist. Nothing was deleted; check the selection and try again."
            : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ShieldWarningIcon aria-hidden="true" weight="fill" className="size-5 text-status-risk" />
              Delete {plural(ids.length)} permanently?
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              This removes their passwords, MFA details, backup codes, notes and custom fields from the vault. It can't
              be undone. Archive them instead if you might need them again.
            </DialogDescription>
          </DialogHeader>
          <Field id="bulk-delete-confirm" label={`Type “${phrase}” to confirm`} error={error}>
            <Input
              id="bulk-delete-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("bulk-delete-confirm", { error: Boolean(error) })}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || busy}>
              Delete {plural(ids.length)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shown while accounts are selected: how many, and what to do with them.
 * Every action runs in one transaction in Rust: all or nothing.
 */
export function BulkActionBar({
  selected,
  archived,
  onClear,
}: {
  selected: AccountSummary[];
  /** The Archived list: offer Restore instead of Archive. */
  archived: boolean;
  onClear: () => void;
}) {
  const changed = useIdentitiesChanged();
  const [deleting, setDeleting] = useState(false);
  const ids = selected.map((a) => a.id);
  const done = () => {
    changed();
    onClear();
  };

  async function archive() {
    try {
      const r = await accounts.bulkArchive(ids, !archived);
      toast.success(`${plural(r.changed)} ${archived ? "restored" : "archived"}`);
      done();
    } catch (err) {
      toast.error(archived ? "Couldn't restore" : "Couldn't archive", { description: toIpcError(err).message });
    }
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex shrink-0 items-center gap-1 border-t border-border-strong bg-popover px-6 py-2"
    >
      <p className="mr-2 text-[13px] font-medium text-foreground">{selected.length} selected</p>
      <BulkTag selected={selected} onDone={done} />
      <Button type="button" variant="ghost" size="sm" onClick={() => void archive()}>
        {archived ? <ArrowCounterClockwiseIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
        {archived ? "Restore" : "Archive"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-status-risk hover:text-status-risk"
        onClick={() => {
          setDeleting(true);
        }}
      >
        <TrashIcon aria-hidden="true" />
        Delete…
      </Button>
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <XIcon aria-hidden="true" />
        Clear selection
      </Button>
      <BulkDeleteDialog ids={ids} open={deleting} onOpenChange={setDeleting} onDeleted={done} />
    </div>
  );
}
