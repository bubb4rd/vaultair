import { useRef, useState, type SubmitEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PAGE_PATHS, getNavLabel } from "@/app/nav";
import { ArrowCounterClockwiseIcon, KeyIcon, PasswordIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import {
  useAccount,
  useAccountUpdated,
  useContactPoints,
  useGames,
  useIdentityRefs,
  usePlatforms,
  usePurposes,
  useTags,
} from "@/app/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { Field, FieldError, describedBy } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, Textarea } from "@/components/ui/textarea";
import { emailProvider } from "@/features/catalog/logos";
import { GeneratorPopover } from "@/features/generator/GeneratorPopover";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import {
  accounts,
  isIpcError,
  secrets,
  toIpcError,
  type AccountDetail,
  type AccountInput,
  type AccountStatus,
  type AccountType,
  type ContactPointView,
  type IdentityRef,
  type PlatformView,
} from "@/ipc/client";
import { CustomFieldsEditor, draftsFrom, toInputs, type CustomFieldDraft } from "./CustomFieldsEditor";
import { ACCOUNT_TYPES, FORM_STATUSES } from "./labels";
import { mailboxFields } from "./mailbox";
import { scanNotes, suggestionLines } from "./notesHints";
import { freshSecret, toUpdate, type SecretEdit } from "./secretEdit";

interface FormState {
  title: string;
  accountType: AccountType;
  purposeId: string;
  status: AccountStatus;
  identityId: string;
  username: string;
  email: string;
  recoveryEmail: string;
  recoveryPhone: string;
  websiteUrl: string;
  loginUrl: string;
  platformId: string;
  gameId: string;
  publisher: string;
  region: string;
  playerId: string;
  displayName: string;
  notes: string;
  tags: string[];
  password: SecretEdit;
  sensitiveNotes: SecretEdit;
  customFields: CustomFieldDraft[];
}

type Errors = Partial<Record<string, string>>;

const MESSAGES: Record<string, string> = {
  title: "Enter a name for this account.",
  purposeId: "Choose a purpose.",
  identityId: "That identity no longer exists. Choose another one.",
  platformId: "That platform no longer exists. Choose another one.",
  gameId: "That game no longer exists. Choose another one.",
  email: "Enter an email address like name@example.com.",
  recoveryEmail: "Enter an email address like name@example.com.",
  recoveryPhone: "Keep the phone reference on one line.",
  websiteUrl: "Enter a web address that starts with https:// or http://.",
  loginUrl: "Enter a web address that starts with https:// or http://.",
  password: "A password can't contain control characters or be longer than 4,096 characters.",
  sensitiveNotes: "Sensitive notes can be up to 20,000 characters.",
  notes: "Notes can be up to 20,000 characters.",
  tags: "Tags can be up to 40 characters each, and an account can have up to 32.",
  customFields: "Check the custom fields: each needs a label, and each value has to match its type.",
};

function blank(purposeId: string, identityId: string): FormState {
  return {
    title: "",
    accountType: "launcher",
    purposeId,
    status: "active",
    identityId,
    username: "",
    email: "",
    recoveryEmail: "",
    recoveryPhone: "",
    websiteUrl: "",
    loginUrl: "",
    platformId: "",
    gameId: "",
    publisher: "",
    region: "",
    playerId: "",
    displayName: "",
    notes: "",
    tags: [],
    password: { mode: "set", value: "" },
    sensitiveNotes: { mode: "set", value: "" },
    customFields: [],
  };
}

function fromDetail(d: AccountDetail): FormState {
  return {
    title: d.title,
    accountType: d.accountType,
    purposeId: d.purposeId,
    status: d.status,
    identityId: d.identityId ?? "",
    username: d.username ?? "",
    email: d.email ?? "",
    recoveryEmail: d.recoveryEmail ?? "",
    recoveryPhone: d.recoveryPhone ?? "",
    websiteUrl: d.websiteUrl ?? "",
    loginUrl: d.loginUrl ?? "",
    platformId: d.platformId ?? "",
    gameId: d.gameId ?? "",
    publisher: d.publisher ?? "",
    region: d.region ?? "",
    playerId: d.playerId ?? "",
    displayName: d.displayName ?? "",
    notes: d.notes ?? "",
    tags: d.tags,
    password: freshSecret(d.hasPassword),
    sensitiveNotes: freshSecret(d.hasSensitiveNotes),
    customFields: draftsFrom(d.customFields),
  };
}

const opt = (s: string) => (s.trim() === "" ? null : s);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function toInput(f: FormState): AccountInput {
  return {
    title: f.title,
    accountType: f.accountType,
    purposeId: f.purposeId,
    status: f.status,
    identityId: opt(f.identityId),
    username: opt(f.username),
    email: opt(f.email),
    password: toUpdate(f.password),
    recoveryEmail: opt(f.recoveryEmail),
    recoveryPhone: opt(f.recoveryPhone),
    websiteUrl: opt(f.websiteUrl),
    loginUrl: opt(f.loginUrl),
    platformId: opt(f.platformId),
    gameId: opt(f.gameId),
    publisher: opt(f.publisher),
    region: opt(f.region),
    playerId: opt(f.playerId),
    displayName: opt(f.displayName),
    notes: opt(f.notes),
    sensitiveNotes: toUpdate(f.sensitiveNotes),
    tags: f.tags,
    customFields: toInputs(f.customFields),
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
  help?: string | undefined;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string | undefined;
  required?: boolean;
  inputMode?: "email" | "url" | "text";
  list?: string;
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

/** The saved-secret row: "A password is saved", with Change and Remove. */
export function StoredSecret({
  label,
  edit,
  onChange,
  onEdit,
  editLabel = "Change",
}: {
  label: string;
  edit: SecretEdit;
  onChange: (e: SecretEdit) => void;
  onEdit: () => void;
  editLabel?: string;
}) {
  if (edit.mode === "clear") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border-strong px-3 py-2">
        <p className="text-[13px] text-muted-foreground">The saved {label} will be removed when you save.</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ mode: "keep" });
          }}
        >
          <ArrowCounterClockwiseIcon aria-hidden="true" />
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-strong bg-background/40 px-3 py-2">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <KeyIcon aria-hidden="true" className="size-4 text-subtle-foreground" />
        A {label} is saved and hidden.
      </p>
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          {editLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ mode: "clear" });
          }}
        >
          <TrashIcon aria-hidden="true" />
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Tag chips plus an input with suggestions. Shared by the account and identity forms. */
export function TagsInput({
  id = "acct-tags",
  listLabel = "Tags on this account",
  tags,
  onChange,
  error,
}: {
  id?: string;
  listLabel?: string;
  tags: string[];
  onChange: (t: string[]) => void;
  error?: string | undefined;
}) {
  const suggestions = useTags();
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const tag = raw.trim().replace(/,$/, "").trim();
    if (!tag) return;
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
    setDraft("");
  }
  return (
    <Field id={id} label="Tags" error={error} help="Press Enter or type a comma to add a tag.">
      <div className="flex flex-col gap-2">
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={listLabel}>
            {tags.map((t) => (
              <li key={t} className="inline-flex h-7 items-center gap-1 rounded-md bg-muted pr-1 pl-2.5 text-[13px]">
                {t}
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    onChange(tags.filter((x) => x !== t));
                  }}
                >
                  <XIcon aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Input
          id={id}
          list={`${id}-suggestions`}
          value={draft}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          placeholder="ranked, pc, shared-email"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { help: true, error: Boolean(error) })}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            add(draft);
          }}
        />
        <datalist id={`${id}-suggestions`}>
          {(suggestions.data ?? [])
            .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
    </Field>
  );
}

/** While typing: account details that may belong in their own field (ADR-0006). */
function NotesHint({ text }: { text: string }) {
  const lines = suggestionLines(scanNotes(text));
  if (lines.length === 0) return null;
  return (
    <div className="rounded-md border border-status-linked/40 bg-status-linked/8 px-3 py-2 text-[13px] text-muted-foreground">
      <p className="font-medium text-foreground">Some of this may belong in its own field</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
        {lines.map((l) => (
          <li key={l.key}>{l.text}</li>
        ))}
      </ul>
    </div>
  );
}

function Form({ initial, existing }: { initial: FormState; existing: AccountDetail | null }) {
  const navigate = useNavigate();
  const purposes = usePurposes();
  const identityRefs = useIdentityRefs();
  const contacts = useContactPoints();
  const platforms = usePlatforms();
  const games = useGames();
  const updated = useAccountUpdated();
  const [form, setForm] = useState(initial);
  const platform = platforms.data?.find((p) => p.id === form.platformId);
  const game = games.data?.find((g) => g.id === form.gameId);
  const catalogLogin = platform?.defaultLoginUrl ? hostOf(platform.defaultLoginUrl) : null;
  // An email account without a platform: offer the provider its address is at.
  const provider = form.accountType === "email" && !form.platformId ? emailProvider(form.email) : null;
  const providerPlatform = provider ? platforms.data?.find((p) => p.id === provider.platformId) : undefined;
  // An archived identity isn't offered for new picks, but an account that
  // already has one keeps showing it.
  const identityOptions = [...(identityRefs.data ?? [])];
  if (existing?.identityId && existing.identityName && !identityOptions.some((r) => r.id === existing.identityId)) {
    identityOptions.push({ id: existing.identityId, name: `${existing.identityName} (archived)`, color: null });
  }
  // Likewise a hidden purpose: only an account that already has it sees it.
  const purposeOptions = (purposes.data ?? [])
    .filter((p) => !p.isHidden || p.id === existing?.purposeId)
    .map((p) => ({ id: p.id, name: p.isHidden ? `${p.name} (hidden)` : p.name }));
  const emails = (contacts.data ?? []).filter((c) => c.kind === "email").map((c) => c.value);
  const phones = (contacts.data ?? []).filter((c) => c.kind === "phone").map((c) => c.value);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Fields the user set themselves: inferring from the email never overwrites them.
  const [touched, setTouched] = useState<ReadonlySet<keyof FormState>>(() => new Set());
  // What the email filled in, and what those fields held before, for Undo.
  const [inferred, setInferred] = useState<{ summary: string; previous: Partial<FormState> } | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  }

  /**
   * A new account whose first detail is a Gmail, Outlook, Yahoo... address
   * is most likely that mailbox, so the email fills in the type, platform,
   * name and publisher. Only while those are still blank and untouched: on
   * a Steam account the email is just its login, and once there's a name
   * the "Set the platform" suggestion below is offered instead.
   */
  function changeEmail(value: string) {
    set("email", value);
    if (existing || inferred) return;
    const match = emailProvider(value);
    const entry = match ? platforms.data?.find((p) => p.id === match.platformId) : undefined;
    const untouched = !touched.has("accountType") && !touched.has("platformId") && !touched.has("title");
    if (!entry || !untouched || form.title.trim() !== "" || form.platformId) return;
    const fill: Partial<FormState> = { accountType: "email", platformId: entry.id, title: entry.name };
    if (form.publisher.trim() === "" && entry.publisher) fill.publisher = entry.publisher;
    const previous: Partial<FormState> = {
      accountType: form.accountType,
      platformId: form.platformId,
      title: form.title,
      ...(fill.publisher ? { publisher: form.publisher } : {}),
    };
    setForm((f) => ({ ...f, ...fill }));
    setInferred({
      summary: [
        "type Email",
        `platform ${entry.name}`,
        `name “${entry.name}”`,
        fill.publisher ? `publisher ${fill.publisher}` : null,
      ]
        .filter(Boolean)
        .join(", "),
      previous,
    });
  }

  function undoInference() {
    if (!inferred) return;
    setForm((f) => ({ ...f, ...inferred.previous }));
    // Undone on purpose: don't infer again from the next keystroke.
    setTouched((t) => new Set([...t, "accountType", "platformId"]));
    setInferred(null);
  }

  function focusField(field: string) {
    const el = formRef.current?.querySelector<HTMLElement>(`#acct-${field}`);
    el?.focus();
  }

  async function revealNotesForEditing() {
    if (!existing) return;
    try {
      const value = await secrets.reveal({ kind: "sensitiveNotes", id: existing.id });
      set("sensitiveNotes", { mode: "set", value });
    } catch (err) {
      toast.error("Couldn't open the sensitive notes", { description: toIpcError(err).message });
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (form.title.trim() === "") local.title = MESSAGES.title;
    if (!form.purposeId) local.purposeId = MESSAGES.purposeId;
    if (Object.keys(local).length > 0) {
      setErrors(local);
      focusField(Object.keys(local)[0] ?? "title");
      return;
    }
    setSaving(true);
    try {
      const input = toInput(form);
      const detail = existing ? await accounts.update(existing.id, input) : await accounts.create(input);
      updated(detail);
      toast.success(existing ? "Changes saved" : "Account added", { description: detail.title });
      void navigate({ to: "/accounts/$accountId", params: { accountId: detail.id } });
    } catch (err) {
      const error = toIpcError(err);
      if (isIpcError(err) && error.code === "invalid_input" && error.field) {
        setErrors({ [error.field]: MESSAGES[error.field] ?? error.message });
        focusField(error.field);
      } else {
        toast.error("Couldn't save the account", { description: error.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-2xl flex-col gap-8">
          <Section title="Account">
            <TextField
              id="acct-title"
              label="Name"
              value={form.title}
              required
              placeholder="e.g. Battle.net main"
              error={errors.title}
              onChange={(v) => {
                set("title", v);
              }}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field id="acct-accountType" label="Type">
                <NativeSelect
                  id="acct-accountType"
                  value={form.accountType}
                  onChange={(e) => {
                    set("accountType", e.target.value as AccountType);
                  }}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="acct-purposeId" label="Purpose" error={errors.purposeId}>
                <NativeSelect
                  id="acct-purposeId"
                  value={form.purposeId}
                  aria-invalid={errors.purposeId ? true : undefined}
                  aria-describedby={describedBy("acct-purposeId", { error: Boolean(errors.purposeId) })}
                  onChange={(e) => {
                    set("purposeId", e.target.value);
                  }}
                >
                  {purposeOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="acct-identityId" label="Identity" error={errors.identityId}>
                <NativeSelect
                  id="acct-identityId"
                  value={form.identityId}
                  aria-invalid={errors.identityId ? true : undefined}
                  aria-describedby={describedBy("acct-identityId", { error: Boolean(errors.identityId) })}
                  onChange={(e) => {
                    set("identityId", e.target.value);
                  }}
                >
                  <option value="">No identity</option>
                  {identityOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="acct-status" label="Status">
                <NativeSelect
                  id="acct-status"
                  value={form.status}
                  onChange={(e) => {
                    set("status", e.target.value as AccountStatus);
                  }}
                >
                  {FORM_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="acct-platformId"
                label="Platform"
                error={errors.platformId}
                help="Where you sign in: a launcher, console network or service."
              >
                <NativeSelect
                  id="acct-platformId"
                  value={form.platformId}
                  aria-invalid={errors.platformId ? true : undefined}
                  aria-describedby={describedBy("acct-platformId", {
                    help: true,
                    error: Boolean(errors.platformId),
                  })}
                  onChange={(e) => {
                    set("platformId", e.target.value);
                  }}
                >
                  <option value="">No platform</option>
                  {(platforms.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="acct-gameId"
                label="Game"
                error={errors.gameId}
                help="For an account that belongs to one game."
              >
                <NativeSelect
                  id="acct-gameId"
                  value={form.gameId}
                  aria-invalid={errors.gameId ? true : undefined}
                  aria-describedby={describedBy("acct-gameId", { help: true, error: Boolean(errors.gameId) })}
                  onChange={(e) => {
                    set("gameId", e.target.value);
                  }}
                >
                  <option value="">No game</option>
                  {(games.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <p className="text-xs text-subtle-foreground">
              Missing one?{" "}
              <Link
                to={PAGE_PATHS.platforms}
                className="rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Add a platform
              </Link>{" "}
              or{" "}
              <Link
                to={PAGE_PATHS.games}
                className="rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                a game
              </Link>
              .
            </p>
            {providerPlatform && (
              <p className="text-xs text-muted-foreground">
                That's a {providerPlatform.name} address.{" "}
                <button
                  type="button"
                  className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    set("platformId", providerPlatform.id);
                  }}
                >
                  Set the platform to {providerPlatform.name}
                </button>
              </p>
            )}
          </Section>

          <Section title="Sign-in" description="The password is encrypted separately and stays hidden until you ask for it.">
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="acct-username"
                label="Username"
                value={form.username}
                error={errors.username}
                onChange={(v) => {
                  set("username", v);
                }}
              />
              <TextField
                id="acct-email"
                label="Email"
                type="email"
                inputMode="email"
                list="acct-email-suggestions"
                value={form.email}
                error={errors.email}
                onChange={changeEmail}
              />
            </div>
            {inferred && (
              <p role="status" className="text-xs text-muted-foreground">
                Filled in from the address: {inferred.summary}.{" "}
                <button
                  type="button"
                  className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={undoInference}
                >
                  Undo
                </button>
              </p>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor="acct-password" className="text-[13px] font-medium text-foreground">
                Password
              </label>
              {form.password.mode === "set" ? (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <PasswordInput
                      id="acct-password"
                      value={form.password.value}
                      aria-invalid={errors.password ? true : undefined}
                      aria-describedby={describedBy("acct-password", { error: Boolean(errors.password) })}
                      placeholder={existing?.hasPassword ? "New password" : undefined}
                      onChange={(e) => {
                        set("password", { mode: "set", value: e.target.value });
                      }}
                    />
                  </div>
                  <GeneratorPopover
                    onUse={(value) => {
                      set("password", { mode: "set", value });
                    }}
                  >
                    <Button type="button" variant="outline" className="h-9">
                      <PasswordIcon aria-hidden="true" />
                      Generate
                    </Button>
                  </GeneratorPopover>
                  {existing?.hasPassword && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9"
                      onClick={() => {
                        set("password", { mode: "keep" });
                      }}
                    >
                      Keep current
                    </Button>
                  )}
                </div>
              ) : (
                <StoredSecret
                  label="password"
                  edit={form.password}
                  onChange={(p) => {
                    set("password", p);
                  }}
                  onEdit={() => {
                    set("password", { mode: "set", value: "" });
                    setTimeout(() => {
                      focusField("password");
                    }, 0);
                  }}
                />
              )}
              {errors.password && <FieldError id="acct-password-error">{errors.password}</FieldError>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="acct-websiteUrl"
                label="Website"
                inputMode="url"
                placeholder="https://"
                value={form.websiteUrl}
                error={errors.websiteUrl}
                onChange={(v) => {
                  set("websiteUrl", v);
                }}
              />
              <TextField
                id="acct-loginUrl"
                label="Login page"
                inputMode="url"
                placeholder="https://"
                help={
                  catalogLogin && !form.loginUrl.trim()
                    ? `Empty uses ${platform?.name ?? "the platform"}'s catalog login page (${catalogLogin}).`
                    : undefined
                }
                value={form.loginUrl}
                error={errors.loginUrl}
                onChange={(v) => {
                  set("loginUrl", v);
                }}
              />
            </div>
          </Section>

          <Section
            title="Recovery"
            description="Where a password reset goes. Vaultair uses these to show which accounts depend on which email or phone."
          >
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="acct-recoveryEmail"
                label="Recovery email"
                type="email"
                inputMode="email"
                list="acct-email-suggestions"
                value={form.recoveryEmail}
                error={errors.recoveryEmail}
                onChange={(v) => {
                  set("recoveryEmail", v);
                }}
              />
              <TextField
                id="acct-recoveryPhone"
                label="Recovery phone"
                placeholder="Pixel, ends 42"
                list="acct-phone-suggestions"
                help="A reference is enough; a full number is optional."
                value={form.recoveryPhone}
                error={errors.recoveryPhone}
                onChange={(v) => {
                  set("recoveryPhone", v);
                }}
              />
            </div>
            <datalist id="acct-email-suggestions">
              {emails.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <datalist id="acct-phone-suggestions">
              {phones.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Section>

          <Section title="Game details">
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="acct-publisher"
                label="Publisher"
                placeholder={game?.publisher ?? platform?.publisher ?? undefined}
                value={form.publisher}
                error={errors.publisher}
                onChange={(v) => {
                  set("publisher", v);
                }}
              />
              <TextField
                id="acct-region"
                label="Region or server"
                value={form.region}
                error={errors.region}
                onChange={(v) => {
                  set("region", v);
                }}
              />
              <TextField
                id="acct-playerId"
                label="Player ID"
                value={form.playerId}
                error={errors.playerId}
                onChange={(v) => {
                  set("playerId", v);
                }}
              />
              <TextField
                id="acct-displayName"
                label="Display name"
                value={form.displayName}
                error={errors.displayName}
                onChange={(v) => {
                  set("displayName", v);
                }}
              />
            </div>
          </Section>

          <Section title="Organize">
            <TagsInput
              tags={form.tags}
              error={errors.tags}
              onChange={(t) => {
                set("tags", t);
              }}
            />
          </Section>

          <Section title="Custom fields" description="Anything else worth keeping. Hidden fields are encrypted like the password.">
            <CustomFieldsEditor
              fields={form.customFields}
              error={errors.customFields}
              onChange={(c) => {
                set("customFields", c);
              }}
            />
          </Section>

          <Section title="Notes">
            <Field id="acct-notes" label="Notes" error={errors.notes} help="Included in search.">
              <Textarea
                id="acct-notes"
                value={form.notes}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={describedBy("acct-notes", { help: true, error: Boolean(errors.notes) })}
                onChange={(e) => {
                  set("notes", e.target.value);
                }}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <label htmlFor="acct-sensitiveNotes" className="text-[13px] font-medium text-foreground">
                Sensitive notes
              </label>
              {form.sensitiveNotes.mode === "set" ? (
                <Textarea
                  id="acct-sensitiveNotes"
                  value={form.sensitiveNotes.value}
                  aria-invalid={errors.sensitiveNotes ? true : undefined}
                  aria-describedby="acct-sensitiveNotes-help"
                  onChange={(e) => {
                    set("sensitiveNotes", { mode: "set", value: e.target.value });
                  }}
                />
              ) : (
                <StoredSecret
                  label="note"
                  editLabel="Edit"
                  edit={form.sensitiveNotes}
                  onChange={(n) => {
                    set("sensitiveNotes", n);
                  }}
                  onEdit={() => void revealNotesForEditing()}
                />
              )}
              <p id="acct-sensitiveNotes-help" className="text-[13px] text-muted-foreground">
                Encrypted and hidden like the password, and never included in search.
              </p>
              {form.sensitiveNotes.mode === "set" && <NotesHint text={form.sensitiveNotes.value} />}
              {errors.sensitiveNotes && <FieldError>{errors.sensitiveNotes}</FieldError>}
            </div>
          </Section>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-6 py-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving" : existing ? "Save changes" : "Add account"}
        </Button>
        <Button asChild variant="ghost">
          {existing ? (
            <Link to="/accounts/$accountId" params={{ accountId: existing.id }}>
              Cancel
            </Link>
          ) : (
            <Link to={PAGE_PATHS.accounts}>Cancel</Link>
          )}
        </Button>
      </div>
    </form>
  );
}

/**
 * A new account for the mailbox behind an email: an email account signing in
 * with the address, named and placed by its provider, under the identity
 * that names the address as its own.
 */
function forMailbox(
  start: FormState,
  mailbox: ContactPointView,
  platforms: PlatformView[],
  identities: IdentityRef[],
): FormState {
  const fields = mailboxFields(mailbox.value, platforms);
  const owner = identities.some((r) => r.id === mailbox.identityId) ? (mailbox.identityId ?? "") : "";
  return {
    ...start,
    accountType: "email",
    email: mailbox.value,
    title: fields.title,
    platformId: fields.platformId ?? "",
    publisher: fields.publisher ?? "",
    identityId: start.identityId || owner,
  };
}

/**
 * New account (`accountId` undefined) or edit an existing one. `mailboxId`
 * is an email's contact point: a new account then starts as that mailbox.
 */
export function AccountForm({
  accountId,
  identityId,
  mailboxId,
}: {
  accountId?: string;
  identityId?: string;
  mailboxId?: string;
}) {
  const purposes = usePurposes();
  // Loaded before the form renders, so the identity select never flashes the
  // current identity as archived while the list is still on its way.
  const identityRefs = useIdentityRefs();
  const existing = useAccount(accountId ?? "", accountId !== undefined);
  const editing = accountId !== undefined;
  // The form keeps its first values, so a mailbox's details have to be in before it renders.
  const contacts = useContactPoints();
  const platforms = usePlatforms();
  const fromMailbox = !editing && mailboxId !== undefined;
  const mailbox = fromMailbox ? contacts.data?.find((c) => c.id === mailboxId && c.kind === "email") : undefined;
  const waiting = fromMailbox && (contacts.isPending || platforms.isPending);

  let body: ReactNode = null;
  if (editing && existing.isError) {
    body = (
      <div className="px-6">
        <EmptyState icon={KeyIcon} title="Account not found" description="It may have been deleted." />
      </div>
    );
  } else if (purposes.data && !identityRefs.isPending && !waiting && (!editing || existing.data)) {
    const firstVisible = purposes.data.find((p) => !p.isHidden)?.id ?? "";
    const start = blank(firstVisible, identityId ?? "");
    const initial =
      editing && existing.data
        ? fromDetail(existing.data)
        : mailbox
          ? forMailbox(start, mailbox, platforms.data ?? [], identityRefs.data ?? [])
          : start;
    body = <Form key={accountId ?? "new"} initial={initial} existing={editing ? (existing.data ?? null) : null} />;
  }

  let headerCrumbs;
  if (editing && existing.data) {
    const parent = existing.data.archivedAt
      ? { label: getNavLabel(PAGE_PATHS.archived), to: PAGE_PATHS.archived }
      : { label: getNavLabel(PAGE_PATHS.accounts), to: PAGE_PATHS.accounts };
    headerCrumbs = [
      { label: "Vault", to: "/" },
      parent,
      {
        label: existing.data.title,
        to: "/accounts/$accountId",
        params: { accountId: existing.data.id },
        truncate: true,
      },
      { label: "Edit" },
    ];
  } else {
    headerCrumbs = [
      { label: "Vault", to: "/" },
      { label: getNavLabel(PAGE_PATHS.accounts), to: PAGE_PATHS.accounts },
      { label: "New account" },
    ];
  }

  return (
    <>
      <PageHeader crumbs={headerCrumbs} />
      {body}
    </>
  );
}

