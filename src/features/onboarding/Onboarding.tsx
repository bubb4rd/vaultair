import { useCallback, useState } from "react";
import { vault, type IpcError, type KdfParams, type VaultInfo } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/features/shell/BrandMark";
import { DragBar } from "@/features/shell/DragBar";
import {
  BackupsStep,
  ChecklistStep,
  CreateFailedStep,
  CreateStep,
  LocationStep,
  NameStep,
  PasswordStep,
  PrivacyStep,
  RecoveryStep,
  WelcomeStep,
} from "./steps";

type StepId =
  | "welcome"
  | "privacy"
  | "recovery"
  | "name"
  | "location"
  | "password"
  | "create"
  | "failed"
  | "checklist"
  | "backups";

/** The progress bar groups the screens into five named stages (no "Step 1 of 9"). */
const STAGES: { label: string; steps: StepId[] }[] = [
  { label: "Welcome", steps: ["welcome", "privacy", "recovery"] },
  { label: "Your vault", steps: ["name", "location"] },
  { label: "Master password", steps: ["password"] },
  { label: "Create", steps: ["create", "failed"] },
  { label: "Next steps", steps: ["checklist", "backups"] },
];

type Direction = "forward" | "back";

function stageIndex(step: StepId) {
  return STAGES.findIndex((s) => s.steps.includes(step));
}

function detailsStepFor(error: IpcError | null): StepId {
  if (error?.code === "weak_password") return "password";
  if (error?.code === "vault_exists" || error?.field === "location") return "location";
  return "name";
}

interface OnboardingProps {
  /** "Open an existing vault": hand over to the lock screen. */
  onOpenExisting: () => void;
  /** The vault was created (and is unlocked) and the user finished the flow. */
  onFinished: (info: VaultInfo) => void;
}

/**
 * First-run setup (implementation plan, Phase 4). The master password is held
 * in this component's state only between the password screen and creation,
 * then cleared. It never goes into a global store, the query cache or the URL.
 */
export function Onboarding({ onOpenExisting, onFinished }: OnboardingProps) {
  // `dir` picks the enter animation: forward slides in from the right, Back from the left.
  const [{ step, dir }, setNav] = useState<{ step: StepId; dir: Direction }>({ step: "welcome", dir: "forward" });
  const setStep = (next: StepId, direction: Direction = "forward") => {
    setNav({ step: next, dir: direction });
  };
  const [demo, setDemo] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [name, setName] = useState("My vault");
  const [location, setLocation] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<VaultInfo | null>(null);
  const [failure, setFailure] = useState<IpcError | null>(null);

  const create = useCallback(
    (kdf: KdfParams) => {
      const request = { name, location, kdf, password };
      return demo ? vault.createDemo(request) : vault.create(request);
    },
    [demo, name, location, password],
  );

  const handleCreated = useCallback((info: VaultInfo) => {
    setPassword("");
    setCreated(info);
    setNav({ step: "checklist", dir: "forward" });
  }, []);

  const handleFailed = useCallback((error: IpcError) => {
    setFailure(error);
    setNav({ step: "failed", dir: "forward" });
  }, []);

  const go = (next: StepId) => () => {
    setStep(next);
  };
  const back = (to: StepId) => () => {
    setStep(to, "back");
  };

  let screen;
  switch (step) {
    case "welcome":
      screen = (
        <WelcomeStep
          onNext={() => {
            setDemo(false);
            setStep("privacy");
          }}
          onDemo={() => {
            setDemo(true);
            setName("Demo vault");
            setStep("privacy");
          }}
          onOpenExisting={onOpenExisting}
        />
      );
      break;
    case "privacy":
      screen = <PrivacyStep onNext={go("recovery")} onBack={back("welcome")} />;
      break;
    case "recovery":
      screen = (
        <RecoveryStep
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          onNext={go("name")}
          onBack={back("privacy")}
        />
      );
      break;
    case "name":
      screen = <NameStep name={name} demo={demo} onChange={setName} onNext={go("location")} onBack={back("recovery")} />;
      break;
    case "location":
      screen = (
        <LocationStep
          name={name}
          location={location}
          onLocation={setLocation}
          onNext={go("password")}
          onBack={back("name")}
        />
      );
      break;
    case "password":
      screen = (
        <PasswordStep password={password} onPassword={setPassword} onNext={go("create")} onBack={back("location")} />
      );
      break;
    case "create":
      screen = <CreateStep create={create} onCreated={handleCreated} onFailed={handleFailed} />;
      break;
    case "failed":
      screen = failure && (
        <CreateFailedStep error={failure} onRetry={go("create")} onBack={back(detailsStepFor(failure))} />
      );
      break;
    case "checklist":
      screen = <ChecklistStep onNext={go("backups")} />;
      break;
    case "backups":
      screen = (
        <BackupsStep
          onFinish={() => {
            if (created) onFinished(created);
          }}
        />
      );
      break;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <DragBar>
        <BrandMark className="pointer-events-none size-5" />
        <span data-tauri-drag-region className="text-[14px] font-semibold tracking-[-0.01em]">
          Vaultair
        </span>
      </DragBar>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[560px] px-6 pt-[5vh] pb-12">
          <SetupProgress step={step} />
          {/* Keyed by step, so each screen mounts fresh and plays its enter animation. */}
          <div
            key={step}
            data-direction={dir}
            className={cn(
              "pt-10 animate-in fade-in duration-300 ease-out",
              dir === "forward" ? "slide-in-from-right-6" : "slide-in-from-left-6",
            )}
          >
            {screen}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Horizontal, segmented progress (one segment per stage), as in mobile
 * onboarding. The current segment fills a little on each screen within its
 * stage. The stage names are read to screen readers; sighted users see the
 * current stage's name under the bar.
 */
function SetupProgress({ step }: { step: StepId }) {
  const current = stageIndex(step);
  const stage = STAGES[current];
  return (
    <nav aria-label="Setup progress" className="flex flex-col gap-2.5">
      <ol className="grid grid-cols-5 gap-1.5">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const fill = done ? 100 : active ? ((s.steps.indexOf(step) + 1) / s.steps.length) * 100 : 0;
          return (
            <li key={s.label} aria-current={active ? "step" : undefined}>
              <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-border-strong">
                <span
                  className="block h-full rounded-full bg-brand transition-[width] duration-200 ease-out"
                  style={{ width: `${String(fill)}%` }}
                />
              </span>
              <span className="sr-only">
                {s.label}
                {done && " (done)"}
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-hidden="true" className="text-xs font-medium text-muted-foreground">
        {stage?.label}
      </p>
    </nav>
  );
}
