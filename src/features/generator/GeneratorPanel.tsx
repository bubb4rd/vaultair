import type { ReactNode } from "react";
import { ArrowsClockwiseIcon, CopyIcon } from "@phosphor-icons/react";
import { FieldError, describedBy, fieldIds } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedGroup, SegmentedItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { copyToClipboard } from "@/features/clipboard/copy";
import { PageHeader } from "@/features/shell/PageHeader";
import type { PassphraseOptions, PasswordOptions } from "@/ipc/client";
import { CountControl, GeneratedValue, KIND_LABEL, ModeSwitch, StrengthRow } from "./parts";
import { LIMITS, generatorErrorMessage, useGenerator, type Generator } from "./useGenerator";

type ClassKey = "uppercase" | "lowercase" | "digits" | "symbols";

const CLASSES: { key: ClassKey; label: string; sample: string }[] = [
  { key: "uppercase", label: "Uppercase letters", sample: "A-Z" },
  { key: "lowercase", label: "Lowercase letters", sample: "a-z" },
  { key: "digits", label: "Numbers", sample: "0-9" },
  { key: "symbols", label: "Symbols", sample: "!#$%&*+-?@^_~" },
];

const SEPARATORS: { value: string; name: string; glyph: string }[] = [
  { value: "-", name: "Hyphen", glyph: "-" },
  { value: " ", name: "Space", glyph: "Space" },
  { value: ".", name: "Period", glyph: "." },
  { value: "_", name: "Underscore", glyph: "_" },
  { value: ",", name: "Comma", glyph: "," },
];

function OptionSwitch({
  id,
  label,
  hint,
  checked,
  disabled,
  describedById,
  onChange,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  describedById?: string | undefined;
  onChange: (checked: boolean) => void;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {hint && (
          <span id={hintId} className="truncate font-mono text-xs text-subtle-foreground">
            {hint}
          </span>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={[hintId, describedById].filter(Boolean).join(" ") || undefined}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function PasswordOptionsForm({
  options,
  excludeInvalid,
  onChange,
}: {
  options: PasswordOptions;
  excludeInvalid: boolean;
  onChange: (patch: Partial<PasswordOptions>) => void;
}) {
  const selected = CLASSES.filter((c) => options[c.key]).length;
  const excludeIds = fieldIds("gen-exclude");
  return (
    <div className="flex flex-col gap-5">
      <CountControl
        id="gen-length"
        label="Length"
        value={options.length}
        min={LIMITS.length.min}
        max={LIMITS.length.max}
        onChange={(length) => {
          onChange({ length });
        }}
      />
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-[13px] font-medium text-muted-foreground">Use these characters</legend>
        {CLASSES.map((c) => {
          const isLast = options[c.key] && selected === 1;
          return (
            <OptionSwitch
              key={c.key}
              id={`gen-${c.key}`}
              label={c.label}
              hint={c.sample}
              checked={options[c.key]}
              disabled={isLast}
              describedById={isLast ? "gen-classes-help" : undefined}
              onChange={(on) => {
                onChange({ [c.key]: on });
              }}
            />
          );
        })}
        {selected === 1 && (
          <p id="gen-classes-help" className="text-[13px] text-muted-foreground">
            At least one type of character is needed.
          </p>
        )}
      </fieldset>
      <OptionSwitch
        id="gen-ambiguous"
        label="Avoid look-alike characters"
        hint="Leaves out I l 1 O 0 o"
        checked={options.excludeAmbiguous}
        onChange={(excludeAmbiguous) => {
          onChange({ excludeAmbiguous });
        }}
      />
      <div className="flex flex-col gap-2">
        <label htmlFor="gen-exclude" className="text-[13px] font-medium">
          Leave out characters
        </label>
        <Input
          id="gen-exclude"
          value={options.exclude}
          maxLength={128}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={excludeInvalid || undefined}
          aria-describedby={describedBy("gen-exclude", { help: true, error: excludeInvalid })}
          className="font-mono"
          onChange={(e) => {
            onChange({ exclude: e.target.value });
          }}
        />
        <p id={excludeIds.help} className="text-[13px] text-muted-foreground">
          For sites that reject some characters. Type them here, for example {"<>{}"}.
        </p>
        {excludeInvalid && (
          <FieldError id={excludeIds.error}>
            Every character of a selected type is left out.
          </FieldError>
        )}
      </div>
    </div>
  );
}

function PassphraseOptionsForm({
  options,
  onChange,
}: {
  options: PassphraseOptions;
  onChange: (patch: Partial<PassphraseOptions>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <CountControl
        id="gen-words"
        label="Words"
        value={options.words}
        min={LIMITS.words.min}
        max={LIMITS.words.max}
        onChange={(words) => {
          onChange({ words });
        }}
      />
      <div className="flex items-center justify-between gap-4">
        <span id="gen-separator-label" className="text-[13px] font-medium">
          Separator
        </span>
        <SegmentedGroup
          aria-labelledby="gen-separator-label"
          value={options.separator}
          onValueChange={(separator) => {
            onChange({ separator });
          }}
        >
          {SEPARATORS.map((s) => (
            <SegmentedItem key={s.name} value={s.value} aria-label={s.name} className="font-mono">
              {s.glyph}
            </SegmentedItem>
          ))}
        </SegmentedGroup>
      </div>
      <div className="flex flex-col">
        <OptionSwitch
          id="gen-capitalize"
          label="Capitalize words"
          checked={options.capitalize}
          onChange={(capitalize) => {
            onChange({ capitalize });
          }}
        />
        <OptionSwitch
          id="gen-number"
          label="Add a number"
          hint="One digit after a random word"
          checked={options.includeNumber}
          onChange={(includeNumber) => {
            onChange({ includeNumber });
          }}
        />
      </div>
    </div>
  );
}

/** The value, its strength, and Copy / Generate another. */
function OutputPanel({ gen }: { gen: Generator }) {
  const { settings, result, error, regenerate } = gen;
  const kind = KIND_LABEL[settings.mode];
  return (
    <section aria-label={`Generated ${kind.toLowerCase()}`} className="rounded-lg border border-border bg-card p-4">
      {error ? (
        <div className="min-h-14">
          <FieldError>{generatorErrorMessage(error)}</FieldError>
        </div>
      ) : (
        <GeneratedValue value={result?.value ?? null} className="min-h-14" />
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <StrengthRow result={result} kind={settings.mode} />
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="Generate another" title="Generate another" onClick={regenerate}>
            <ArrowsClockwiseIcon aria-hidden="true" />
          </Button>
          <Button
            disabled={!result}
            onClick={() => {
              if (result) void copyToClipboard(result.value, kind);
            }}
          >
            <CopyIcon aria-hidden="true" />
            Copy
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The Generator page (sidebar and Ctrl+K). */
export function GeneratorPanel() {
  const gen = useGenerator();
  const { settings, error, setMode, setPassword, setPassphrase } = gen;
  const excludeInvalid = error?.code === "invalid_input" && error.field === "exclude";
  return (
    <>
      <PageHeader title="Generator" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-[640px] flex-col gap-6">
          <ModeSwitch mode={settings.mode} onChange={setMode} />
          <OutputPanel gen={gen} />
          {settings.mode === "password" ? (
            <PasswordOptionsForm options={settings.password} excludeInvalid={excludeInvalid} onChange={setPassword} />
          ) : (
            <PassphraseOptionsForm options={settings.passphrase} onChange={setPassphrase} />
          )}
          <p className="text-[13px] text-muted-foreground">
            Generated on this device from Windows&apos; secure random source. Nothing here is saved, and copies are
            cleared from the clipboard automatically.
          </p>
        </div>
      </div>
    </>
  );
}
