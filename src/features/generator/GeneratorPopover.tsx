import { useState, type ReactNode } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { FieldError } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copyToClipboard } from "@/features/clipboard/copy";
import { CountControl, GeneratedValue, KIND_LABEL, ModeSwitch, StrengthRow } from "./parts";
import { LIMITS, generatorErrorMessage, useGenerator } from "./useGenerator";

/** Only mounted while the popover is open, so it generates on open, not on page load. */
function GeneratorPopoverBody({ onUse }: { onUse: (value: string) => void }) {
  const { settings, result, error, setMode, setPassword, setPassphrase, regenerate } = useGenerator();
  const kind = KIND_LABEL[settings.mode];
  return (
    <div className="flex flex-col gap-4">
      <ModeSwitch mode={settings.mode} onChange={setMode} className="w-full" />
      <div className="flex items-start gap-2">
        {error ? (
          <div className="min-h-14 flex-1">
            <FieldError>{generatorErrorMessage(error)}</FieldError>
          </div>
        ) : (
          <GeneratedValue value={result?.value ?? null} label={kind} className="min-h-14 flex-1 text-[15px] leading-6" />
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Generate another" title="Generate another" onClick={regenerate}>
          <ArrowsClockwiseIcon aria-hidden="true" />
        </Button>
      </div>
      <StrengthRow result={result} kind={settings.mode} />
      {settings.mode === "password" ? (
        <CountControl
          id="gen-pop-length"
          label="Length"
          value={settings.password.length}
          min={LIMITS.length.min}
          max={LIMITS.length.max}
          onChange={(length) => {
            setPassword({ length });
          }}
        />
      ) : (
        <CountControl
          id="gen-pop-words"
          label="Words"
          value={settings.passphrase.words}
          min={LIMITS.words.min}
          max={LIMITS.words.max}
          onChange={(words) => {
            setPassphrase({ words });
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">Other options are on the Generator page and apply here too.</p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!result}
          onClick={() => {
            if (result) void copyToClipboard(result.value, kind);
          }}
        >
          Copy
        </Button>
        <Button
          size="sm"
          disabled={!result}
          onClick={() => {
            if (result) onUse(result.value);
          }}
        >
          Use {kind.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact generator anchored to a trigger (the account form's password field
 * in Phase 7). `onUse` receives the value and the popover closes.
 */
export function GeneratorPopover({ onUse, children }: { onUse: (value: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent aria-label="Generate a password" className="w-[340px]">
        <GeneratorPopoverBody
          onUse={(value) => {
            onUse(value);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
