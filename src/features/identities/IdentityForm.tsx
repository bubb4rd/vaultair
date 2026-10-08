import { useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, IdentificationBadgeIcon } from "@phosphor-icons/react";
import { PAGE_PATHS, getNavLabel } from "@/app/nav";
import { useIdentity, useIdentityUpdated } from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { Field, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagsInput } from "@/features/accounts/AccountForm";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import {
  identities,
  isIpcError,
  toIpcError,
  type IdentityColor,
  type IdentityDetail,
  type IdentityInput,
} from "@/ipc/client";
import { cn } from "@/lib/utils";
import { IDENTITY_COLORS, IdentityAvatar } from "./IdentityAvatar";

interface FormState {
  name: string;
  description: string;
  primaryEmail: string;
  recoveryEmail: string;
  phoneRef: string;
  notes: string;
  color: IdentityColor | null;
  tags: string[];
}

type Errors = Partial<Record<keyof FormState, string | undefined>>;

const MESSAGES: Record<string, string> = {
  name: "Enter a name for this identity.",
  nameTaken: "Another identity already has this name.",
  description: "Keep the description under 500 characters, on one line.",
  primaryEmail: "Enter an email address like name@example.com.",
  recoveryEmail: "Enter an email address like name@example.com.",
  phoneRef: "Keep the phone reference on one line.",
  notes: "Notes can be up to 20,000 characters.",
  tags: "Tags can be up to 40 characters each, and an identity can have up to 32.",
};

const BLANK: FormState = {
  name: "",
  description: "",
  primaryEmail: "",
  recoveryEmail: "",
  phoneRef: "",
  notes: "",
  color: "blue",
  tags: [],
};

function fromDetail(d: IdentityDetail): FormState {
  return {
    name: d.name,
    description: d.description ?? "",
    primaryEmail: d.primaryEmail ?? "",
    recoveryEmail: d.recoveryEmail ?? "",
    phoneRef: d.phoneRef ?? "",
    notes: d.notes ?? "",
    color: d.color,
    tags: d.tags,
  };
}

const opt = (s: string) => (s.trim() === "" ? null : s);

function toInput(f: FormState): IdentityInput {
  return {
    name: f.name,
    description: opt(f.description),
    primaryEmail: opt(f.primaryEmail),
    recoveryEmail: opt(f.recoveryEmail),
    phoneRef: opt(f.phoneRef),
    notes: opt(f.notes),
    color: f.color,
    tags: f.tags,
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full">
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted-foreground">{description}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  help,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  help?: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "email" | "text";
}) {
  return (
    <Field id={id} label={label} error={error} help={help}>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { help: Boolean(help), error: Boolean(error) })}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...rest}
      />
    </Field>
  );
}

/** Colour swatches as native radios: arrow keys move, each has a name. */
export function ColorPicker({
  value,
  name,
  group = "identity-color",
  onChange,
}: {
  value: IdentityColor | null;
  name: string;
  /** The radios' `name`, unique per form. */
  group?: string;
  onChange: (c: IdentityColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex items-center gap-4">
      <IdentityAvatar name={name || "?"} color={value} size="lg" />
      <div className="flex flex-wrap gap-2">
        {IDENTITY_COLORS.map((c) => {
          const checked = value === c.value;
          return (
            <label
              key={c.value}
              className="relative grid size-8 cursor-pointer place-items-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={group}
                value={c.value}
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
                  "grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-background",
                  c.swatch,
                  checked && "ring-2 ring-foreground",
                )}
              >
                {checked && <CheckIcon weight="bold" className="size-3.5 text-background" />}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Form({ initial, existing }: { initial: FormState; existing: IdentityDetail | null }) {
  const navigate = useNavigate();
  const updated = useIdentityUpdated();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function focusField(field: string) {
    formRef.current?.querySelector<HTMLElement>(`#ident-${field}`)?.focus();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (form.name.trim() === "") {
      setErrors({ name: MESSAGES.name });
      focusField("name");
      return;
    }
    setSaving(true);
    try {
      const input = toInput(form);
      const detail = existing ? await identities.update(existing.id, input) : await identities.create(input);
      updated(detail);
      toast.success(existing ? "Changes saved" : "Identity created", { description: detail.name });
      void navigate({ to: "/identities/$identityId", params: { identityId: detail.id } });
    } catch (err) {
      const error = toIpcError(err);
      if (isIpcError(err) && error.code === "invalid_input" && error.field) {
        const field = error.field as keyof FormState;
        // A non-empty name only fails server-side for being taken.
        const message = field === "name" ? MESSAGES.nameTaken : (MESSAGES[field] ?? error.message);
        setErrors({ [field]: message });
        focusField(field);
      } else {
        toast.error("Couldn't save the identity", { description: error.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-2xl flex-col gap-8">
          <Section title="Identity">
            <TextField
              id="ident-name"
              label="Name"
              value={form.name}
              required
              placeholder="e.g. Competitive"
              error={errors.name}
              onChange={(v) => {
                set("name", v);
              }}
            />
            <TextField
              id="ident-description"
              label="Description"
              value={form.description}
              placeholder="What this persona is for"
              error={errors.description}
              onChange={(v) => {
                set("description", v);
              }}
            />
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">Color</span>
              <ColorPicker
                value={form.color}
                name={form.name}
                onChange={(c) => {
                  set("color", c);
                }}
              />
            </div>
          </Section>

          <Section
            title="Contact"
            description="The email and phone this identity signs up and recovers with. Accounts that use them show up on its page."
          >
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="ident-primaryEmail"
                label="Primary email"
                type="email"
                inputMode="email"
                value={form.primaryEmail}
                error={errors.primaryEmail}
                onChange={(v) => {
                  set("primaryEmail", v);
                }}
              />
              <TextField
                id="ident-recoveryEmail"
                label="Recovery email"
                type="email"
                inputMode="email"
                value={form.recoveryEmail}
                error={errors.recoveryEmail}
                onChange={(v) => {
                  set("recoveryEmail", v);
                }}
              />
            </div>
            <TextField
              id="ident-phoneRef"
              label="Phone"
              value={form.phoneRef}
              placeholder="Pixel, ends 42"
              help="A reference like “Pixel, ends 42” is enough to recognize it. A full number is optional."
              error={errors.phoneRef}
              onChange={(v) => {
                set("phoneRef", v);
              }}
            />
          </Section>

          <Section title="Organize">
            <TagsInput
              id="ident-tags"
              listLabel="Tags on this identity"
              tags={form.tags}
              error={errors.tags}
              onChange={(t) => {
                set("tags", t);
              }}
            />
            <Field id="ident-notes" label="Notes" error={errors.notes} help="Included in search. Don't put passwords here.">
              <Textarea
                id="ident-notes"
                value={form.notes}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={describedBy("ident-notes", { help: true, error: Boolean(errors.notes) })}
                onChange={(e) => {
                  set("notes", e.target.value);
                }}
              />
            </Field>
          </Section>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-6 py-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving" : existing ? "Save changes" : "Create identity"}
        </Button>
        <Button asChild variant="ghost">
          {existing ? (
            <Link to="/identities/$identityId" params={{ identityId: existing.id }}>
              Cancel
            </Link>
          ) : (
            <Link to={PAGE_PATHS.identities}>Cancel</Link>
          )}
        </Button>
      </div>
    </form>
  );
}

/** New identity (`identityId` undefined) or edit an existing one. */
export function IdentityForm({ identityId }: { identityId?: string }) {
  const editing = identityId !== undefined;
  const existing = useIdentity(identityId ?? "", editing);

  let body: ReactNode = null;
  if (editing && existing.isError) {
    body = (
      <div className="px-6">
        <EmptyState icon={IdentificationBadgeIcon} title="Identity not found" description="It may have been deleted." />
      </div>
    );
  } else if (!editing) {
    body = <Form key="new" initial={BLANK} existing={null} />;
  } else if (existing.data) {
    body = <Form key={identityId} initial={fromDetail(existing.data)} existing={existing.data} />;
  }

  let headerCrumbs;
  if (editing && existing.data) {
    headerCrumbs = [
      { label: "Vault", to: "/" },
      { label: getNavLabel(PAGE_PATHS.identities), to: PAGE_PATHS.identities },
      {
        label: existing.data.name,
        to: "/identities/$identityId",
        params: { identityId: existing.data.id },
        truncate: true,
      },
      { label: "Edit" },
    ];
  } else {
    headerCrumbs = [
      { label: "Vault", to: "/" },
      { label: getNavLabel(PAGE_PATHS.identities), to: PAGE_PATHS.identities },
      { label: "New identity" },
    ];
  }

  return (
    <>
      <PageHeader crumbs={headerCrumbs} />
      {body}
    </>
  );
}

