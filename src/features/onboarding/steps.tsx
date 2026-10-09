import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CircleNotchIcon,
  CloudIcon,
  CpuIcon,
  FolderSimpleIcon,
  HardDrivesIcon,
  KeyIcon,
  ShieldWarningIcon,
  WarningIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { describedBy, Field, FieldError } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  strengthEstimate,
  toIpcError,
  vault,
  type IpcError,
  type KdfParams,
  type LocationCheck,
  type StrengthEstimate,
  type VaultInfo,
} from "@/ipc/client";
import { PROVIDER_NAMES } from "@/features/backup/labels";
import { StepPage } from "./StepPage";
import { Requirement, StrengthMeter } from "./StrengthMeter";
import { vaultNameError } from "./vaultName";

/* Copy follows docs/privacy-statement-draft.md and docs/forgot-master-password.md. */

export function WelcomeStep({
  onNext,
  onDemo,
  onOpenExisting,
}: {
  onNext: () => void;
  onDemo: () => void;
  onOpenExisting: () => void;
}) {
  return (
    <StepPage
      title="Set up your vault"
      intro="Vaultair keeps your gaming and online accounts, the identities behind them, and how to recover them, in one encrypted vault on this PC."
      primary="Get started"
      onSubmit={onNext}
      secondary={
        <Button type="button" variant="ghost" size="lg" onClick={onOpenExisting}>
          Open an existing vault
        </Button>
      }
    >
      <p className="text-[13px] text-muted-foreground">
        Want to look around first?{" "}
        <button
          type="button"
          onClick={onDemo}
          className="font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Create a demo vault
        </button>
      </p>
    </StepPage>
  );
}

const PROMISES = [
  {
    icon: HardDrivesIcon,
    title: "Stored on this PC",
    body: "Your vault is a folder on this PC. There is no Vaultair account and no Vaultair server.",
  },
  {
    icon: WifiSlashIcon,
    title: "No network connections",
    body: "Vaultair doesn't connect to the internet. It can't upload, sync or send anything about you.",
  },
  {
    icon: KeyIcon,
    title: "Encrypted with your master password",
    body: "Everything in the vault is encrypted with a key made from your master password, which Vaultair never stores.",
  },
];

export function PrivacyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <StepPage title="Everything stays on this PC" primary="Continue" onSubmit={onNext} onBack={onBack}>
      <ul className="flex flex-col gap-5">
        {PROMISES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border-strong bg-card text-muted-foreground">
              <Icon aria-hidden="true" className="size-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[14px] font-medium">{title}</p>
              <p className="text-[13px] text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </StepPage>
  );
}

export function RecoveryStep({
  acknowledged,
  onAcknowledge,
  onNext,
  onBack,
}: {
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const id = "ack-no-recovery";
  return (
    <StepPage
      title="We can't recover your master password"
      intro={
        <>
          <p>
            Your master password is the only way to open your vault. Vaultair never stores it and has no server, so
            there is no reset link and nobody who can recover it for you.
          </p>
          <p className="mt-3">If you forget it, the data in this vault can&apos;t be opened, by you or anyone else.</p>
        </>
      }
      primary="Continue"
      onBack={onBack}
      onSubmit={() => {
        if (!acknowledged) {
          setError("Tick the box to continue.");
          document.getElementById(id)?.focus();
          return;
        }
        onNext();
      }}
    >
      <div className="flex flex-col gap-2">
        {/* Danger styling on purpose: this is the one irreversible fact in setup. */}
        <label
          htmlFor={id}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
            "border-status-risk/45 bg-status-risk/8 hover:bg-status-risk/12",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
            error && "border-status-risk",
          )}
        >
          <input
            id={id}
            type="checkbox"
            checked={acknowledged}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, { error: Boolean(error) })}
            onChange={(e) => {
              onAcknowledge(e.target.checked);
              if (e.target.checked) setError(null);
            }}
            className="mt-0.5 size-4 shrink-0 accent-[var(--status-risk)] focus-visible:outline-none"
          />
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-status-risk">
              <ShieldWarningIcon aria-hidden="true" weight="fill" className="size-4" />
              There is no way to recover a forgotten master password
            </span>
            <span className="text-[14px] text-foreground">
              I understand that if I forget my master password, my vault can&apos;t be opened.
            </span>
          </span>
        </label>
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </div>
    </StepPage>
  );
}

export function NameStep({
  name,
  demo,
  onChange,
  onNext,
  onBack,
}: {
  name: string;
  demo: boolean;
  onChange: (name: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const id = "vault-name";
  return (
    <StepPage
      title="Name your vault"
      intro={
        demo
          ? "This vault will be marked as a demo. It comes with sample accounts to explore. All the data is made up, with no real credentials."
          : "Most people need one vault. The name is only for you."
      }
      primary="Continue"
      onBack={onBack}
      onSubmit={() => {
        const problem = vaultNameError(name);
        setError(problem);
        if (problem) document.getElementById(id)?.focus();
        else onNext();
      }}
    >
      <Field
        id={id}
        label="Vault name"
        help="Also used as the vault's folder name. Letters, numbers, spaces and - _ . ( )"
        error={error}
      >
        <Input
          id={id}
          value={name}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { help: true, error: Boolean(error) })}
          onChange={(e) => {
            onChange(e.target.value);
            if (error) setError(null);
          }}
          className="max-w-sm"
        />
      </Field>
    </StepPage>
  );
}

export function LocationStep({
  name,
  location,
  onLocation,
  onNext,
  onBack,
}: {
  name: string;
  location: string | null;
  onLocation: (location: string | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [check, setCheck] = useState<LocationCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    vault
      .checkLocation(location, name)
      .then((c) => {
        if (!cancelled) setCheck(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toIpcError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [location, name]);

  async function choose() {
    setError(null);
    try {
      const picked = await vault.pickFolder("newVaultLocation");
      if (picked) onLocation(picked);
    } catch (err) {
      setError(toIpcError(err).message);
    }
  }

  const cloud = check?.cloudProvider ? PROVIDER_NAMES[check.cloudProvider] : null;
  const blocked = !check || check.alreadyExists;

  return (
    <StepPage
      title="Choose where to keep it"
      intro="Your vault is saved as a folder on this PC. Keep it somewhere that isn't synced to a cloud service."
      primary="Continue"
      onBack={onBack}
      busy={!check}
      onSubmit={() => {
        if (!blocked) onNext();
      }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium" id="vault-dir-label">
          Your vault will be created in
        </p>
        <div
          aria-labelledby="vault-dir-label"
          role="group"
          className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2.5"
        >
          <FolderSimpleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 font-mono text-[13px] break-all select-text" data-testid="vault-dir">
            {check?.vaultDir ?? " "}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void choose()}>
            Choose another folder
          </Button>
          {location !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onLocation(null);
              }}
            >
              Use the default folder
            </Button>
          )}
        </div>
      </div>

      {cloud && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3.5 animate-in fade-in slide-in-from-top-1 duration-300"
        >
          <CloudIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <div className="space-y-1">
            <p className="text-[14px] font-medium text-status-warning">This folder is synced by {cloud}</p>
            <p className="text-[13px] text-muted-foreground">
              Your vault stays encrypted, but {cloud} will upload a copy of it, so it won&apos;t be only on this PC.
              Choose a local folder unless that&apos;s what you want.
            </p>
          </div>
        </div>
      )}

      {check?.alreadyExists && (
        <FieldError>
          A folder named &ldquo;{name}&rdquo; already has files in it here. Choose another folder, or go back and
          change the name.
        </FieldError>
      )}
      {error && <FieldError>{error}</FieldError>}
    </StepPage>
  );
}

export function PasswordStep({
  password,
  onPassword,
  onNext,
  onBack,
}: {
  password: string;
  onPassword: (password: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [estimate, setEstimate] = useState<StrengthEstimate | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [checking, setChecking] = useState(false);

  // Scored in Rust as you type, debounced. Nothing is stored.
  useEffect(() => {
    if (password.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      strengthEstimate(password)
        .then((e) => {
          if (!cancelled) setEstimate(e);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [password]);

  async function submit() {
    setChecking(true);
    const current = await strengthEstimate(password).catch(() => null);
    setChecking(false);
    const next: { password?: string; confirm?: string } = {};
    if (!current?.longEnough) next.password = "Use at least 12 characters.";
    else if (!current.meetsPolicy) next.password = "This is too easy to guess. Try a longer passphrase.";
    if (confirm !== password) next.confirm = "The two entries don't match.";
    setErrors(next);
    if (next.password) document.getElementById("new-password")?.focus();
    else if (next.confirm) document.getElementById("confirm-password")?.focus();
    else onNext();
  }

  const shown = password.length > 0 ? estimate : null;
  const matches = confirm.length > 0 && confirm === password;

  return (
    <StepPage
      title="Create your master password"
      intro="You'll type this every time you unlock Vaultair. Four or more unrelated words make a strong passphrase that's easier to remember than random characters."
      primary="Create vault"
      busy={checking}
      onBack={onBack}
      onSubmit={submit}
    >
      <div className="flex max-w-sm flex-col gap-5">
        <Field id="new-password" label="Master password" error={errors.password}>
          <PasswordInput
            id="new-password"
            value={password}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={[describedBy("new-password", { error: Boolean(errors.password) }), "strength"]
              .filter(Boolean)
              .join(" ")}
            onChange={(e) => {
              onPassword(e.target.value);
              if (errors.password) setErrors(({ confirm: c }) => (c ? { confirm: c } : {}));
            }}
          />
        </Field>
        <StrengthMeter id="strength" estimate={shown} />
        <Field id="confirm-password" label="Confirm master password" error={errors.confirm}>
          <PasswordInput
            id="confirm-password"
            value={confirm}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={describedBy("confirm-password", { error: Boolean(errors.confirm) })}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors(({ password: p }) => (p ? { password: p } : {}));
            }}
          />
        </Field>
        <ul aria-label="Requirements" className="flex flex-col gap-1.5">
          <Requirement met={shown?.longEnough ?? false}>At least 12 characters</Requirement>
          <Requirement met={(shown?.score ?? 0) >= 3}>Strength of Good or better</Requirement>
          <Requirement met={matches}>Both entries match</Requirement>
        </ul>
      </div>
    </StepPage>
  );
}

type CreatePhase = "measuring" | "encrypting";

export function CreateStep({
  create,
  onCreated,
  onFailed,
}: {
  create: (kdf: KdfParams) => Promise<VaultInfo>;
  onCreated: (info: VaultInfo) => void;
  onFailed: (error: IpcError) => void;
}) {
  const [phase, setPhase] = useState<CreatePhase>("measuring");
  const started = useRef(false);

  useEffect(() => {
    // Runs once, even under StrictMode's double effect: creating twice would fail.
    if (started.current) return;
    started.current = true;
    (async () => {
      const kdf = await vault.calibrateKdf();
      setPhase("encrypting");
      return create(kdf);
    })().then(onCreated, (err: unknown) => {
      onFailed(toIpcError(err));
    });
  }, [create, onCreated, onFailed]);

  return (
    <StepPage
      title="Securing your vault"
      intro="Vaultair tunes the encryption to this PC so that every guess at your password takes about a second of work. This takes a few seconds."
    >
      <ol aria-live="polite" className="flex flex-col gap-3">
        <Progress icon={CpuIcon} done={phase !== "measuring"} active={phase === "measuring"}>
          Measuring this PC
        </Progress>
        <Progress icon={KeyIcon} done={false} active={phase === "encrypting"}>
          Encrypting your vault
        </Progress>
      </ol>
    </StepPage>
  );
}

function Progress({
  icon: Icon,
  done,
  active,
  children,
}: {
  icon: typeof CpuIcon;
  done: boolean;
  active: boolean;
  children: string;
}) {
  return (
    <li
      className={
        active || done ? "flex items-center gap-3 text-foreground" : "flex items-center gap-3 text-subtle-foreground"
      }
    >
      {active ? (
        <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin text-brand" />
      ) : (
        <Icon aria-hidden="true" className={done ? "size-4 text-status-secure" : "size-4"} />
      )}
      <span className="text-[14px]">
        {children}
        {done && <span className="sr-only"> (done)</span>}
        {active && <span className="sr-only"> (in progress)</span>}
      </span>
    </li>
  );
}

export function CreateFailedStep({
  error,
  onRetry,
  onBack,
}: {
  error: IpcError;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <StepPage
      title="Your vault wasn't created"
      primary="Try again"
      onSubmit={onRetry}
      secondary={
        <Button type="button" variant="ghost" size="lg" onClick={onBack}>
          Change details
        </Button>
      }
    >
      <div className="flex gap-3 rounded-lg border border-status-risk/40 bg-status-risk/8 p-3.5" role="alert">
        <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-risk" />
        <p className="text-[14px]">{error.message}</p>
      </div>
    </StepPage>
  );
}

const CHECKLIST = [
  "Write it on paper and keep it somewhere private at home, with your other important documents.",
  "Don't keep it in a note on this PC, a photo on your phone, or a cloud document.",
  "Don't use it for anything else.",
  "Type it a few times over the next week so it sticks.",
];

export function ChecklistStep({ onNext }: { onNext: () => void }) {
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  return (
    <StepPage
      leading={
        <div className="grid size-10 place-items-center rounded-full bg-status-secure/12 text-status-secure animate-in zoom-in-50 fade-in duration-500 ease-out">
          <CheckIcon aria-hidden="true" weight="bold" className="size-5" />
        </div>
      }
      title="Your vault is ready"
      intro="Before you start, a few ways to keep your master password safe. This list is for you; nothing here is saved."
      primary="Continue"
      onSubmit={onNext}
      secondary={
        <Button type="button" variant="ghost" size="lg" onClick={onNext}>
          Skip
        </Button>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Master password checklist</legend>
        {CHECKLIST.map((item, i) => (
          <label key={item} className="flex cursor-pointer items-start gap-3 rounded-md px-1 py-1.5">
            <input
              type="checkbox"
              checked={checked[i] ?? false}
              onChange={(e) => {
                const on = e.target.checked;
                setChecked((c) => c.map((v, j) => (j === i ? on : v)));
              }}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="text-[14px] text-muted-foreground">{item}</span>
          </label>
        ))}
      </fieldset>
    </StepPage>
  );
}

export function BackupsStep({ onFinish }: { onFinish: () => void }) {
  return (
    <StepPage
      title="Plan for backups"
      intro="A vault on one disk is lost if that disk fails or this PC is lost."
      primary="Open my vault"
      onSubmit={onFinish}
    >
      <ul className="flex max-w-[60ch] list-disc flex-col gap-2 pl-5 text-[14px] text-muted-foreground marker:text-subtle-foreground">
        <li>
          Vaultair makes encrypted backups. Once your vault is open, choose a backup folder in Settings and back up
          from there.
        </li>
        <li>Keep a backup on a USB drive or another disk, not only on this PC.</li>
        <li>A backup opens with the master password it was made with, so keep that password too.</li>
      </ul>
    </StepPage>
  );
}
