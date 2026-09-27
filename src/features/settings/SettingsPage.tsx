import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useSessionConfig } from "@/app/queries";
import { Field, describedBy, fieldIds } from "@/components/common/Field";
import { NativeSelect } from "@/components/ui/textarea";
import { PageHeader } from "@/features/shell/PageHeader";
import { toast } from "@/features/toast/toast";
import { appInfo, session, type AppInfo, type CaptureLevel, type CaptureMode, type SessionConfig } from "@/ipc/client";
import { CAPTURE_LEVELS, CAPTURE_MODES, captureModeDescription } from "./capturePolicy";
import { DevPanel } from "./DevPanel";

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
  const ticket = useRef(0);

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

  if (!saved) return null;
  const mode = draft?.mode ?? saved.captureMode;
  const level = draft?.level ?? saved.captureLevel;

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
          <AppVersion />
          {import.meta.env.DEV && <DevPanel />}
        </div>
      </div>
    </>
  );
}
