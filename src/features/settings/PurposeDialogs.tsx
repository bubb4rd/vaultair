import { useState, type SubmitEvent } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { usePurposes, usePurposesChanged } from "@/app/queries";
import { Field, FieldError, describedBy } from "@/components/common/Field";
import { PURPOSE_COLORS, purposeDot } from "@/components/common/PurposeBadge";
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
import { NativeSelect } from "@/components/ui/textarea";
import { toast } from "@/features/toast/toast";
import { purposes, toIpcError, type PurposeColor, type PurposeView } from "@/ipc/client";
import { cn } from "@/lib/utils";

/** Must match `service::purposes::MAX_NAME_CHARS`. */
export const MAX_PURPOSE_NAME = 40;

const NAME_ERROR = `Enter a name no other label has, up to ${MAX_PURPOSE_NAME} characters.`;

export function accountsText(n: number) {
  return n === 1 ? "1 account" : `${n} accounts`;
}

/** No color, then the palette, as native radios: arrow keys move, each has a name. */
function ColorChoice({ value, onChange }: { value: PurposeColor | null; onChange: (c: PurposeColor | null) => void }) {
  const choices: { value: PurposeColor | null; label: string; dot: string }[] = [
    { value: null, label: "No color", dot: purposeDot(null) },
    ...PURPOSE_COLORS,
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[13px] font-medium">Color</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => {
          const checked = value === c.value;
          return (
            <label
              key={c.value ?? "none"}
              className="relative grid size-8 cursor-pointer place-items-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="purpose-color"
                checked={checked}
                aria-label={c.label}
                className="sr-only"
                onChange={() => {
                  onChange(c.value);
                }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-popover",
                  c.dot,
                  checked && "ring-2 ring-foreground",
                )}
              >
                {checked && (
                  <CheckIcon
                    weight="bold"
                    className={cn("size-3.5", c.value === null ? "text-foreground" : "text-background")}
                  />
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Add a label, or edit one. A built-in only changes color. */
export function PurposeDialog({
  purpose,
  open,
  onOpenChange,
}: {
  purpose: PurposeView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changed = usePurposesChanged();
  const [name, setName] = useState(purpose?.name ?? "");
  const [color, setColor] = useState<PurposeColor | null>(purpose?.color ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const builtin = purpose?.isBuiltin ?? false;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (name.trim() === "" || name.trim().length > MAX_PURPOSE_NAME) {
      setError(NAME_ERROR);
      document.getElementById("purpose-name")?.focus();
      return;
    }
    setSaving(true);
    try {
      const input = { name, color };
      const saved = purpose ? await purposes.update(purpose.id, input) : await purposes.create(input);
      changed();
      toast.success(purpose ? "Changes saved" : "Label added", { description: saved.name });
      onOpenChange(false);
    } catch (err) {
      const ipc = toIpcError(err);
      if (ipc.field === "name") {
        setError(NAME_ERROR);
        document.getElementById("purpose-name")?.focus();
      } else {
        toast.error("Couldn't save the label", { description: ipc.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-popover">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{purpose ? `Edit ${purpose.name}` : "Add a purpose label"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {builtin
                ? "A built-in label. You can change its color; its name stays."
                : "Labels you add can be picked on accounts and used in filters."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field
              id="purpose-name"
              label="Name"
              error={error}
              help={builtin ? "Built-in labels keep their name." : undefined}
            >
              <Input
                id="purpose-name"
                value={name}
                readOnly={builtin}
                placeholder={builtin ? undefined : "e.g. Tournament"}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy("purpose-name", { help: builtin, error: Boolean(error) })}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />
            </Field>
            <ColorChoice value={color} onChange={setColor} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {purpose ? "Save" : "Add label"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deletes a custom label. Accounts that use it (archived ones too) have to
 * move to another visible label first; Rust does both in one step.
 */
export function DeletePurposeDialog({
  purpose,
  open,
  onOpenChange,
}: {
  purpose: PurposeView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changed = usePurposesChanged();
  const others = (usePurposes().data ?? []).filter((p) => p.id !== purpose.id && !p.isHidden);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inUse = purpose.accountCount > 0;
  const targetId = target || others[0]?.id || "";

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await purposes.delete(purpose.id, inUse ? targetId : null);
      changed();
      const moved = others.find((p) => p.id === targetId);
      toast.success("Label deleted", {
        description: inUse && moved ? `${accountsText(purpose.accountCount)} moved to ${moved.name}` : purpose.name,
      });
      onOpenChange(false);
    } catch (err) {
      const ipc = toIpcError(err);
      setError(
        ipc.field === "reassignTo"
          ? "Choose another visible label for its accounts."
          : ipc.field === "lastVisible"
            ? "Keep at least one label visible. Show another label first."
            : ipc.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Delete {purpose.name}?</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              {inUse
                ? `${accountsText(purpose.accountCount)} use this label, archived ones included. They move to the label you choose, and saved views that filter on it follow.`
                : "No accounts use this label. Saved views that filter on it stop doing so."}
            </DialogDescription>
          </DialogHeader>
          {inUse &&
            (others.length > 0 ? (
              <Field id="purpose-reassign" label="Move its accounts to">
                <NativeSelect
                  id="purpose-reassign"
                  value={targetId}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setError(null);
                  }}
                >
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <FieldError>There is no other visible label to move them to. Show one first.</FieldError>
            ))}
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || (inUse && others.length === 0)}>
              Delete label
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
