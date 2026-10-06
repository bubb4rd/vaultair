import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useSessionConfig } from "@/app/queries";
import { Field, describedBy, fieldIds } from "@/components/common/Field";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/textarea";
import { BackupSettings } from "@/features/backup/BackupSettings";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import { appInfo, session, type AppInfo, type CaptureLevel, type CaptureMode, type SessionConfig } from "@/ipc/client";
import { CAPTURE_LEVELS, CAPTURE_MODES, captureModeDescription } from "./capturePolicy";
import { DevPanel } from "./DevPanel";
import { PurposeLabels } from "./PurposeLabels";

function AppVersion() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    appInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!info) return null;
  return (
    <p data-testid="app-version" className="font-mono text-xs text-subtle-foreground">
      {info.name} {info.version}
    </p>
  );
}

function PrivacySettings() {
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
    <section aria-labelledby="privacy-heading" className="flex flex-col gap-4">
      <h2 id="privacy-heading" className="text-[13px] font-semibold">
        Privacy
      </h2>
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="hide-emails" className="text-[13px] font-medium">
            Hide email addresses
          </label>
          <p id="hide-emails-help" className="text-[13px] text-muted-foreground">
            On an account, email and recovery email stay masked until you show them, then hide again like a password.
          </p>
        </div>
        <Switch
          id="hide-emails"
          className="mt-0.5"
          checked={hideEmails}
          aria-describedby="hide-emails-help"
          onCheckedChange={saveHideEmails}
        />
      </div>
    </section>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-xl flex-col gap-10">
          <PrivacySettings />
          <BackupSettings />
          <PurposeLabels />
          <AppVersion />
          {import.meta.env.DEV && <DevPanel />}
        </div>
      </div>
    </>
  );
}
