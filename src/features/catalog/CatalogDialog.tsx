import { useState, type SubmitEvent } from "react";
import { useCatalogChanged } from "@/app/queries";
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
import { NativeSelect } from "@/components/ui/textarea";
import { toast } from "@/features/toast/toast";
import { catalog, isIpcError, toIpcError, type GameView, type PlatformKind, type PlatformView } from "@/ipc/client";

export type CatalogKind = "game" | "platform";

export const PLATFORM_KINDS: { value: PlatformKind; label: string }[] = [
  { value: "launcher", label: "Launcher" },
  { value: "console", label: "Console network" },
  { value: "publisher", label: "Publisher account" },
  { value: "social", label: "Social" },
  { value: "streaming", label: "Streaming" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "app", label: "App" },
  { value: "other", label: "Other" },
];

export function platformKindLabel(kind: PlatformKind) {
  return PLATFORM_KINDS.find((k) => k.value === kind)?.label ?? "Other";
}

interface Draft {
  name: string;
  /** Games only. */
  franchise: string;
  publisher: string;
  /** Platforms only. */
  kind: PlatformKind;
  /** Platforms only. */
  defaultLoginUrl: string;
}

const MESSAGES: Record<string, string> = {
  name: "Enter a name that isn't already in the list.",
  defaultLoginUrl: "Enter a web address that starts with https:// or http://.",
  publisher: "Keep the publisher on one line.",
  franchise: "Keep the series on one line.",
};

const opt = (s: string) => (s.trim() === "" ? null : s);

function draftOf(entry: GameView | PlatformView | null): Draft {
  return {
    name: entry?.name ?? "",
    franchise: entry && "franchise" in entry ? (entry.franchise ?? "") : "",
    publisher: entry?.publisher ?? "",
    kind: entry && "kind" in entry ? entry.kind : "launcher",
    defaultLoginUrl: entry && "defaultLoginUrl" in entry ? (entry.defaultLoginUrl ?? "") : "",
  };
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  help,
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  help?: string | undefined;
  inputMode?: "url" | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <Field id={id} label={label} error={error} help={help}>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, {
          help: Boolean(help),
          error: Boolean(error),
        })}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </Field>
  );
}

/** Add or edit a game or a platform. A built-in keeps its logo when edited. */
export function CatalogDialog({
  kind,
  entry,
  open,
  onOpenChange,
}: {
  kind: CatalogKind;
  entry: GameView | PlatformView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changed = useCatalogChanged();
  const [draft, setDraft] = useState(() => draftOf(entry));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const noun = kind === "game" ? "game" : "platform";

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (draft.name.trim() === "") {
      setErrors({ name: `Enter the ${noun}'s name.` });
      document.getElementById("cat-name")?.focus();
      return;
    }
    setSaving(true);
    try {
      let saved: GameView | PlatformView;
      if (kind === "game") {
        const input = {
          name: draft.name,
          franchise: opt(draft.franchise),
          publisher: opt(draft.publisher),
        };
        saved = entry ? await catalog.updateGame(entry.id, input) : await catalog.createGame(input);
      } else {
        const input = {
          name: draft.name,
          kind: draft.kind,
          publisher: opt(draft.publisher),
          defaultLoginUrl: opt(draft.defaultLoginUrl),
        };
        saved = entry ? await catalog.updatePlatform(entry.id, input) : await catalog.createPlatform(input);
      }
      changed();
      toast.success(entry ? "Changes saved" : `${kind === "game" ? "Game" : "Platform"} added`, {
        description: saved.name,
      });
      onOpenChange(false);
    } catch (err) {
      const error = toIpcError(err);
      if (isIpcError(err) && error.code === "invalid_input" && error.field) {
        setErrors({ [error.field]: MESSAGES[error.field] ?? error.message });
        document.getElementById(`cat-${error.field}`)?.focus();
      } else {
        toast.error(`Couldn't save the ${noun}`, {
          description: error.message,
        });
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
            <DialogTitle className="text-[15px]">{entry ? `Edit ${entry.name}` : `Add a ${noun}`}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {entry?.isBuiltin
                ? `A built-in ${noun}. Your changes are kept, and its logo stays.`
                : kind === "game"
                  ? "Games you add can be picked on accounts and game profiles."
                  : "Platforms you add can be picked on accounts and game profiles."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <TextField
              id="cat-name"
              label="Name"
              value={draft.name}
              error={errors.name}
              onChange={(v) => {
                set("name", v);
              }}
            />
            {kind === "platform" && (
              <Field id="cat-kind" label="Kind">
                <NativeSelect
                  id="cat-kind"
                  value={draft.kind}
                  onChange={(e) => {
                    set("kind", e.target.value as PlatformKind);
                  }}
                >
                  {PLATFORM_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {kind === "game" && (
              <TextField
                id="cat-franchise"
                label="Series"
                value={draft.franchise}
                error={errors.franchise}
                onChange={(v) => {
                  set("franchise", v);
                }}
              />
            )}
            <TextField
              id="cat-publisher"
              label="Publisher"
              value={draft.publisher}
              error={errors.publisher}
              onChange={(v) => {
                set("publisher", v);
              }}
            />
            {kind === "platform" && (
              <TextField
                id="cat-defaultLoginUrl"
                label="Login page"
                inputMode="url"
                placeholder="https://"
                value={draft.defaultLoginUrl}
                error={errors.defaultLoginUrl}
                help={
                  entry?.isBuiltin
                    ? "Catalog-provided. Accounts on this platform without their own login page use it; check it's right."
                    : "Accounts on this platform without their own login page use it."
                }
                onChange={(v) => {
                  set("defaultLoginUrl", v);
                }}
              />
            )}
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
              {entry ? "Save" : `Add ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
