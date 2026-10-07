import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClockCounterClockwiseIcon,
  FingerprintIcon,
  FolderOpenIcon,
  GameControllerIcon,
  HeartbeatIcon,
  LifebuoyIcon,
  LockKeyIcon,
  PlusIcon,
  UserCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { queryKeys, useQuickUnlock, useRecentVaults } from "@/app/queries";
import { describedBy, Field, FieldError } from "@/components/common/Field";
import { PasswordInput } from "@/components/common/PasswordInput";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  quickUnlock,
  recentVaults,
  toIpcError,
  vault,
  type RecentVault,
  type VaultInfo,
} from "@/ipc/client";
import { cn } from "@/lib/utils";
import { RestoreDialog } from "@/features/backup/RestoreDialog";
import { BrandMark } from "@/features/shell/BrandMark";
import { DragBar } from "@/features/shell/DragBar";
import { toast } from "@/features/toast/toast";
import { lockoutSeconds } from "./backoff";
import { PASSWORD_REASON_TEXT } from "./hello";
import { showLockNotice } from "./lockNotice";
import lockBackdrop from "./lock-backdrop.webp";

interface LockScreenProps {
  /** A vault folder to preselect, e.g. one just picked from onboarding. */
  initialPath?: string | null;
  onUnlocked: (info: VaultInfo) => void;
  onCreateNew: () => void;
}

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** The onboarding enter animation: one short fade and lift. Reduced motion removes it (globals.css). */
const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out fill-mode-both";

/** What the vault holds, for the decorative card on the hero panel. All four exist. */
const FEATURES = [
  { icon: UserCircleIcon, label: "Identities" },
  { icon: GameControllerIcon, label: "Accounts" },
  { icon: LifebuoyIcon, label: "Recovery" },
  { icon: HeartbeatIcon, label: "Health" },
];

/** A hairline with a word in it, between the two ways to unlock. */
function OrDivider() {
  return (
    <div aria-hidden="true" className="flex w-full items-center gap-3 text-[12px] text-subtle-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function LockScreen({ initialPath = null, onUnlocked, onCreateNew }: LockScreenProps) {
  const queryClient = useQueryClient();
  const { data: recents = [] } = useRecentVaults();
  const [picked, setPicked] = useState<string | null>(initialPath);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [preferPassword, setPreferPassword] = useState(false);
  const [helloPending, setHelloPending] = useState(false);
  const [helloCancelled, setHelloCancelled] = useState(false);
  const [helloFallback, setHelloFallback] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const waiting = waitSeconds > 0;

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
    },
    [],
  );

  // Say why the vault just locked (button, Ctrl+L, idle, Windows lock, sleep).
  useEffect(() => {
    void showLockNotice();
  }, []);

  /** Disables the form for `seconds`, counting down once a second. */
  function startWait(seconds: number) {
    window.clearInterval(timer.current);
    setWaitSeconds(seconds);
    timer.current = window.setInterval(() => {
      setWaitSeconds((s) => {
        if (s > 1) return s - 1;
        window.clearInterval(timer.current);
        requestAnimationFrame(() => inputRef.current?.focus());
        return 0;
      });
    }, 1000);
  }

  const current = picked ?? recents.find((r) => r.available)?.path ?? recents[0]?.path ?? null;
  const currentEntry = recents.find((r) => r.path === current);
  const available = currentEntry?.available ?? current !== null;
  const others = recents.filter((r) => r.path !== current);

  const quickQuery = useQuickUnlock(available ? current : null);
  const quick = quickQuery.data ?? null;
  // Until Rust has answered, show neither way to unlock: the password form
  // would only flash and be swapped for the Windows Hello button.
  const checkingHello = available && current !== null && quickQuery.isPending;
  const helloReady = quick?.enabled === true && quick.passwordRequired === null;
  const showHello = helloReady && !preferPassword;
  const passwordRequired = quick?.enabled ? quick.passwordRequired : null;
  // Three failed or cancelled Hello attempts: the password form, with a warning.
  // The "didn't go through" explanation stays off this screen.
  const helloDisabled = passwordRequired === "tooManyAttempts";
  const passwordNote = helloDisabled
    ? null
    : (helloFallback ?? (passwordRequired ? PASSWORD_REASON_TEXT[passwordRequired] : null));

  async function unlockWithHello(path: string) {
    setHelloPending(true);
    setHelloCancelled(false);
    setHelloFallback(null);
    try {
      onUnlocked(await quickUnlock.unlock(path));
    } catch (err) {
      const ipc = toIpcError(err);
      setHelloPending(false);
      // A cancelled or failed attempt counts toward the limit of 3.
      void queryClient.invalidateQueries({ queryKey: queryKeys.quickUnlock(path) });
      if (ipc.code === "quick_unlock_cancelled") {
        setHelloCancelled(true);
      } else {
        setPreferPassword(true);
        setHelloFallback(ipc.message);
      }
    }
  }

  function select(path: string) {
    setPicked(path);
    setPassword("");
    setError(null);
    setPreferPassword(false);
    setHelloCancelled(false);
    setHelloFallback(null);
    inputRef.current?.focus();
  }

  async function unlock(e: SubmitEvent) {
    e.preventDefault();
    if (!current || pending || waiting) return;
    if (password.length === 0) {
      setError("Enter your master password.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const info = await vault.unlock(current, password);
      setPassword("");
      onUnlocked(info);
    } catch (err) {
      const ipc = toIpcError(err);
      setError(ipc.message);
      if (ipc.code === "wrong_password") {
        const next = failures + 1;
        setFailures(next);
        const wait = lockoutSeconds(next);
        if (wait > 0) startWait(wait);
      }
      setPending(false);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }

  async function openOther() {
    setError(null);
    try {
      const path = await vault.pickFolder("existingVault");
      if (path) select(path);
    } catch (err) {
      setError(toIpcError(err).message);
    }
  }

  async function forget(entry: RecentVault) {
    const list = await recentVaults.forget(entry.path).catch(() => null);
    if (!list) {
      toast.error("Couldn't update the list", { description: "Try again." });
      return;
    }
    queryClient.setQueryData(queryKeys.recentVaults, list);
    toast.success(`Removed “${entry.name}” from the list`, { description: "The vault itself wasn't touched." });
  }

  const inputId = "unlock-password";
  const helloDisabledId = `${inputId}-hello-disabled`;
  const shownError = waiting ? `Too many incorrect attempts. Try again in ${String(waitSeconds)} s.` : error;

  return (
    <div className="flex h-full flex-col bg-background">
      <DragBar>
        <BrandMark className="pointer-events-none size-5" />
        <span data-tauri-drag-region className="text-[14px] font-semibold tracking-[-0.01em]">
          Vaultair
        </span>
      </DragBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <main className="min-h-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[444px] flex-col px-8 pb-6">
            <div className={cn("my-auto flex flex-col gap-8 py-10", ENTER)}>
              {current ? (
                <>
                  <div className="min-w-0 space-y-1.5">
                    <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words">
                      {currentEntry?.name ?? folderName(current)}
                    </h1>
                    <p className="truncate font-mono text-xs text-subtle-foreground select-text" title={current}>
                      {current}
                    </p>
                  </div>

                  {!available ? (
                    <p role="status" className="text-[13px] text-muted-foreground">
                      This vault&apos;s folder can&apos;t be found. It may have been moved, renamed or deleted, or it
                      may be on a drive that isn&apos;t connected.
                    </p>
                  ) : checkingHello ? (
                    <div aria-hidden="true" className="h-24" />
                  ) : showHello ? (
                    <div className="flex flex-col items-center gap-4">
                      <Button
                        type="button"
                        size="lg"
                        disabled={helloPending}
                        className="w-full"
                        onClick={() => void unlockWithHello(current)}
                      >
                        <FingerprintIcon aria-hidden="true" />
                        {helloPending ? "Waiting for Windows Hello…" : "Unlock with Windows Hello"}
                      </Button>
                      <div aria-live="polite" className="-mt-2 w-full text-center empty:hidden">
                        {helloCancelled && (
                          <p className="text-center text-[13px] text-muted-foreground">Windows Hello was cancelled.</p>
                        )}
                      </div>
                      <OrDivider />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={helloPending}
                        onClick={() => {
                          setPreferPassword(true);
                        }}
                      >
                        Use master password
                      </Button>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => void unlock(e)}
                      noValidate
                      aria-label="Unlock vault"
                      className="flex flex-col gap-4"
                    >
                      {helloDisabled && (
                        <div
                          id={helloDisabledId}
                          role="status"
                          className="flex gap-3 rounded-lg border border-status-warning/40 bg-status-warning/8 p-3"
                        >
                          <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
                          <p className="text-[13px] font-medium text-status-warning">
                            {PASSWORD_REASON_TEXT.tooManyAttempts}
                          </p>
                        </div>
                      )}
                      {passwordNote && (
                        <p id={`${inputId}-note`} className="text-[13px] text-muted-foreground">
                          {passwordNote}
                        </p>
                      )}
                      <Field id={inputId} label="Master password">
                        <PasswordInput
                          id={inputId}
                          ref={inputRef}
                          autoFocus
                          value={password}
                          disabled={pending || waiting}
                          aria-invalid={shownError ? true : undefined}
                          aria-describedby={
                            [
                              describedBy(inputId, { error: Boolean(shownError) }),
                              passwordNote && `${inputId}-note`,
                              helloDisabled && helloDisabledId,
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (error) setError(null);
                          }}
                        />
                      </Field>
                      <div aria-live="polite" className="-mt-2 empty:hidden">
                        {shownError && <FieldError id={`${inputId}-error`}>{shownError}</FieldError>}
                      </div>
                      <Button type="submit" size="lg" disabled={pending || waiting} className="w-full">
                        {pending ? "Unlocking…" : "Unlock"}
                      </Button>
                      {helloReady && (
                        <>
                          <OrDivider />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            className="self-center"
                            onClick={() => {
                              setPreferPassword(false);
                              setHelloFallback(null);
                              setError(null);
                            }}
                          >
                            <FingerprintIcon aria-hidden="true" />
                            Use Windows Hello
                          </Button>
                        </>
                      )}
                    </form>
                  )}
                </>
              ) : (
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-semibold tracking-[-0.02em]">Open a vault</h1>
                  <p className="text-muted-foreground">Choose a vault folder on this PC, or create a new vault.</p>
                  {error && <FieldError>{error}</FieldError>}
                </div>
              )}

              {others.length > 0 && (
                <section aria-labelledby="recent-vaults" className="flex flex-col gap-2">
                  <h2 id="recent-vaults" className="text-xs font-medium text-subtle-foreground">
                    Other vaults
                  </h2>
                  <ul className="flex flex-col gap-0.5">
                    {others.map((r) => (
                      <li key={r.path} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            select(r.path);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-[13px] font-medium",
                                !r.available && "text-muted-foreground",
                              )}
                            >
                              {r.name}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-subtle-foreground">
                              {r.path}
                            </span>
                          </span>
                          {!r.available && <StatusBadge status="unknown" label="Not found" />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${r.name} from this list`}
                          title="Remove from list. The vault itself is not deleted."
                          onClick={() => void forget(r)}
                          className="grid size-7 shrink-0 place-items-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <XIcon aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* Pinned to the bottom of the column. Stacked so the three never wrap into an uneven row. */}
            <div className="border-t border-border pt-4">
              <div className="-ml-2 flex flex-col items-start gap-0.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => void openOther()}>
                  <FolderOpenIcon aria-hidden="true" />
                  Open a different vault
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onCreateNew}>
                  <PlusIcon aria-hidden="true" />
                  Create a new vault
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRestoreOpen(true);
                  }}
                >
                  <ClockCounterClockwiseIcon aria-hidden="true" />
                  Restore a backup
                </Button>
              </div>
            </div>
          </div>
          <RestoreDialog lockScreen open={restoreOpen} onOpenChange={setRestoreOpen} onRestored={select} />
        </main>

        {/* Decorative: the backdrop, one card saying what the vault is, and a tagline.
            Hidden from assistive tech; the form column carries everything that matters. */}
        <div
          aria-hidden="true"
          data-testid="lock-hero"
          className={cn(
            "relative mr-4 mb-4 hidden overflow-hidden rounded-xl border border-border bg-[#111111] md:block",
            "animate-in fade-in zoom-in-95 duration-500 ease-out fill-mode-both",
          )}
        >
          <img
            src={lockBackdrop}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover object-right"
          />
          <div className="absolute inset-0 bg-linear-to-t from-[#111111]/90 via-transparent to-transparent" />
          <div
            className={cn(
              "absolute top-[34%] -left-14 w-[min(420px,calc(100%+24px))] rounded-xl border border-border-strong bg-popover/85 p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md",
              "animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 ease-out fill-mode-both",
            )}
          >
            {/* The heading starts inside the panel; the chip row runs under the cut edge. */}
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border-strong bg-card text-brand">
                <LockKeyIcon className="size-5" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[13px] font-semibold">Encrypted on this PC</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Argon2id and SQLCipher. No account, no server, no network connection.
                </p>
              </div>
            </div>
            <ul className="mt-3.5 flex flex-nowrap gap-1.5 border-t border-border pt-3.5">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[12px] font-medium text-muted-foreground"
                >
                  <Icon className="size-3.5 text-subtle-foreground" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <p className="absolute bottom-7 left-7 max-w-[440px] text-[22px] leading-tight font-semibold tracking-[-0.02em]">
            Every identity, one encrypted vault.
          </p>
        </div>
      </div>
    </div>
  );
}
