import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import { queryKeys, useSessionConfig } from "@/app/queries";
import { Field, describedBy, fieldIds } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/textarea";
import { toast } from "@/features/toast/toast";
import { session, settings, toIpcError, type CaptureLevel, type CaptureMode, type SessionConfig } from "@/ipc/client";
import { CAPTURE_LEVELS, CAPTURE_MODES, captureModeDescription } from "./capturePolicy";
import { SettingsSection, SwitchRow } from "./Section";

/** From docs/privacy-statement-draft.md ("What Vaultair never does"). Keep the two in step. */
const PROMISES = [
  {
    title: "No network.",
    text: "Vaultair makes no network connections: no sync, no analytics, no crash reports, no update checks and no breach lookups.",
  },
  { title: "No account.", text: "There is nothing to sign up for and nobody to sign in to." },
  {
    title: "No copy of your master password.",
    text: "It is used to make a key and then wiped from Vaultair's memory. It is never written anywhere.",
  },
  { title: "No browser storage.", text: "The interface never uses web storage, cookies or IndexedDB." },
  {
    title: "No clipboard history.",
    text: "What you copy is kept out of Windows clipboard history and cloud clipboard, and cleared automatically.",
  },
];

function LogsFolder() {
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    settings
      .logsFolder()
      .then((next) => {
        if (!cancelled) setFolder(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!folder) return null;
  return (
    <div className="flex flex-col gap-2">
      <p id="logs-folder-label" className="text-[13px] font-medium">
        Diagnostic logs
      </p>
      <div
        role="group"
        aria-labelledby="logs-folder-label"
        className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2.5"
      >
        <FolderSimpleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 font-mono text-[13px] break-all select-text" data-testid="logs-folder">
          {folder}
        </span>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Seven days of app events and error categories. They never hold passwords, secrets, usernames, emails, vault
        names or file paths.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            settings.openLogs().catch((err: unknown) => {
              toast.error("Couldn't open the logs folder", { description: toIpcError(err).message });
            });
          }}
        >
          Open logs folder
        </Button>
      </div>
    </div>
  );
}

/** Settings > Privacy: screenshot protection, email masking, the promises and the logs. */
export function PrivacySettings() {
  const queryClient = useQueryClient();
  const saved = useSessionConfig().data;
  const [draft, setDraft] = useState<{ mode: CaptureMode; level: CaptureLevel } | null>(null);
  const [hideDraft, setHideDraft] = useState<boolean | null>(null);
  const ticket = useRef(0);
  const hideTicket = useRef(0);

  function save(nextMode: CaptureMode, nextLevel: CaptureLevel) {
    const mine = ++ticket.current;
    setDraft({ mode: nextMode, level: nextLevel });
    session
      .setCapturePolicy(nextMode, nextLevel)
      .then((next) => {
        if (mine !== ticket.current) return;
        queryClient.setQueryData<SessionConfig>(queryKeys.sessionConfig, next);
        setDraft(null);
      })
      .catch(() => {
        if (mine !== ticket.current) return;
        setDraft(null);
        toast.error("Couldn't save screenshot protection");
      });
  }

  function saveHideEmails(enabled: boolean) {
    const mine = ++hideTicket.current;
    setHideDraft(enabled);
    session
      .setHideEmails(enabled)
      .then((next) => {
        if (mine !== hideTicket.current) return;
        queryClient.setQueryData<SessionConfig>(queryKeys.sessionConfig, next);
        setHideDraft(null);
      })
      .catch(() => {
        if (mine !== hideTicket.current) return;
        setHideDraft(null);
        toast.error("Couldn't save email privacy");
      });
  }

  if (!saved) return null;
  const mode = draft?.mode ?? saved.captureMode;
  const level = draft?.level ?? saved.captureLevel;
  const hideEmails = hideDraft ?? saved.hideEmails;

  const helpId = fieldIds("capture-mode").help;
  return (
    <SettingsSection id="privacy" title="Privacy">
      <Field id="capture-mode" label="Screenshot protection" help={captureModeDescription(mode, level)}>
        <NativeSelect
          id="capture-mode"
          value={mode}
          aria-describedby={describedBy("capture-mode", { help: true })}
          onChange={(event) => {
            save(event.target.value as CaptureMode, level);
          }}
        >
          {CAPTURE_MODES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="capture-level" label="Protect accounts rated">
        <NativeSelect
          id="capture-level"
          value={level}
          disabled={mode !== "custom"}
          aria-describedby={mode === "custom" ? helpId : undefined}
          onChange={(event) => {
            save(mode, event.target.value as CaptureLevel);
          }}
        >
          {CAPTURE_LEVELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SwitchRow
        id="hide-emails"
        label="Hide email addresses"
        help="On an account, email and recovery email stay masked until you show them, then hide again like a password."
        checked={hideEmails}
        onCheckedChange={saveHideEmails}
      />
      <p className="text-[13px] text-muted-foreground">
        These two apply to every vault on this PC, including the lock screen, so they are kept outside the vault.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">What Vaultair never does</h3>
        <ul className="flex flex-col gap-1.5" data-testid="privacy-promises">
          {PROMISES.map((p) => (
            <li key={p.title} className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">{p.title}</span> {p.text}
            </li>
          ))}
        </ul>
      </div>

      <LogsFolder />
    </SettingsSection>
  );
}
