import { useId } from "react";
import { ArrowCounterClockwiseIcon, KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { FieldError } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/textarea";
import type { CustomFieldInput, CustomFieldType, CustomFieldView } from "@/ipc/client";
import { CUSTOM_FIELD_TYPES } from "./labels";
import { freshSecret, toUpdate, type SecretEdit } from "./secretEdit";

export interface CustomFieldDraft {
  /** Stable key for React while editing (new fields have no id yet). */
  key: string;
  id: string | null;
  label: string;
  fieldType: CustomFieldType;
  /** The value for every type except "secret". */
  value: string;
  /** For "secret": whether a value is already stored, and what to do with it. */
  hasStored: boolean;
  secret: SecretEdit;
}

export const MAX_CUSTOM_FIELDS = 50;

export function draftsFrom(views: CustomFieldView[]): CustomFieldDraft[] {
  return views.map((v) => {
    const hasStored = v.fieldType === "secret" && v.hasValue;
    return {
      key: v.id,
      id: v.id,
      label: v.label,
      fieldType: v.fieldType,
      value: v.value ?? "",
      hasStored,
      secret: freshSecret(hasStored),
    };
  });
}

export function toInputs(drafts: CustomFieldDraft[]): CustomFieldInput[] {
  return drafts.map((d) => ({
    id: d.id,
    label: d.label,
    fieldType: d.fieldType,
    value: d.fieldType === "secret" || d.value.trim() === "" ? null : d.value,
    secret: d.fieldType === "secret" ? toUpdate(d.secret) : { op: "unchanged" },
  }));
}

const INPUT_TYPE: Partial<Record<CustomFieldType, string>> = {
  url: "url",
  email: "email",
  number: "number",
  date: "date",
};

let counter = 0;
function newKey() {
  counter += 1;
  return `new-${String(counter)}`;
}

function ValueControl({
  draft,
  id,
  label,
  onChange,
}: {
  draft: CustomFieldDraft;
  id: string;
  label: string;
  onChange: (patch: Partial<CustomFieldDraft>) => void;
}) {
  if (draft.fieldType !== "secret") {
    return (
      <Input
        id={id}
        aria-label={label}
        type={INPUT_TYPE[draft.fieldType] ?? "text"}
        value={draft.value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange({ value: e.target.value });
        }}
      />
    );
  }
  if (draft.secret.mode === "set") {
    return (
      <PasswordInput
        id={id}
        aria-label={label}
        placeholder={draft.hasStored ? "New value" : undefined}
        value={draft.secret.value}
        onChange={(e) => {
          onChange({ secret: { mode: "set", value: e.target.value } });
        }}
      />
    );
  }
  if (draft.secret.mode === "clear") {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-dashed border-border-strong px-3">
        <span className="truncate text-[13px] text-muted-foreground">Removed when you save</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onChange({ secret: { mode: "keep" } });
          }}
        >
          <ArrowCounterClockwiseIcon aria-hidden="true" />
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border-strong bg-background/40 px-3">
      <span className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
        <KeyIcon aria-hidden="true" className="size-3.5 shrink-0" />
        Saved and hidden
      </span>
      <span className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            onChange({ secret: { mode: "set", value: "" } });
          }}
        >
          Change
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onChange({ secret: { mode: "clear" } });
          }}
        >
          Remove
        </Button>
      </span>
    </div>
  );
}

/** Label, type and value per field. Hidden ("secret") values are encrypted like the password. */
export function CustomFieldsEditor({
  fields,
  onChange,
  error,
}: {
  fields: CustomFieldDraft[];
  onChange: (fields: CustomFieldDraft[]) => void;
  error?: string | undefined;
}) {
  const base = useId();
  function patch(key: string, p: Partial<CustomFieldDraft>) {
    onChange(fields.map((f) => (f.key === key ? { ...f, ...p } : f)));
  }
  return (
    <div className="flex flex-col gap-3">
      {fields.length > 0 && (
        <ul className="flex flex-col gap-2">
          {fields.map((f, i) => {
            const n = String(i + 1);
            const labelId = `${base}-label-${n}`;
            return (
              <li key={f.key} className="grid grid-cols-[1fr_120px_1.4fr_auto] items-start gap-2">
                <Input
                  id={i === 0 ? "acct-customFields" : labelId}
                  aria-label={`Field ${n} label`}
                  placeholder="Label"
                  value={f.label}
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    patch(f.key, { label: e.target.value });
                  }}
                />
                <NativeSelect
                  aria-label={`Field ${n} type`}
                  value={f.fieldType}
                  onChange={(e) => {
                    const fieldType = e.target.value as CustomFieldType;
                    patch(f.key, {
                      fieldType,
                      secret: fieldType === "secret" ? freshSecret(f.hasStored) : f.secret,
                    });
                  }}
                >
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
                <ValueControl
                  draft={f}
                  id={`${base}-value-${n}`}
                  label={`Field ${n} value`}
                  onChange={(p) => {
                    patch(f.key, p);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9"
                  aria-label={`Remove field ${n}${f.label ? ` (${f.label})` : ""}`}
                  onClick={() => {
                    onChange(fields.filter((x) => x.key !== f.key));
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_CUSTOM_FIELDS}
          onClick={() => {
            onChange([
              ...fields,
              {
                key: newKey(),
                id: null,
                label: "",
                fieldType: "text",
                value: "",
                hasStored: false,
                secret: { mode: "set", value: "" },
              },
            ]);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add field
        </Button>
      </div>
    </div>
  );
}
