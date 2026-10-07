import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FingerprintIcon } from "@phosphor-icons/react";
import { queryKeys, useOpenVault, useQuickUnlock, useQuickUnlockChanged, useQuickUnlockOffer } from "@/app/queries";
import { Button } from "@/components/ui/button";
import { QuickUnlockDialog } from "@/features/settings/QuickUnlock";
import { toast } from "@/features/toast/toast";
import { quickUnlock, toIpcError } from "@/ipc/client";

/**
 * A small card in the corner, just after the master password opened a vault
 * that Windows Hello could unlock but doesn't yet. "Turn on" goes straight to
 * the Windows Hello prompt: the password was typed a moment ago, so Rust
 * doesn't ask again. If it has been too long, the usual dialog asks for it.
 */
export function HelloOffer() {
  // Nothing else is read until Rust says there is an offer to make.
  return useQuickUnlockOffer().data === true ? <OfferCard /> : null;
}

function OfferCard() {
  const queryClient = useQueryClient();
  const vault = useOpenVault();
  const status = useQuickUnlock(vault?.path ?? null).data ?? null;
  const changed = useQuickUnlockChanged();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askPassword, setAskPassword] = useState(false);

  if (!vault || !status || status.enabled || status.hello !== "available") return null;
  const path = vault.path;

  function decline(forever: boolean) {
    queryClient.setQueryData(queryKeys.quickUnlockOffer, false);
    // Nothing to tell the user if this fails; the card is gone either way.
    quickUnlock.dismissOffer(forever).catch(() => undefined);
  }

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await quickUnlock.enableNow();
      toast.success("Windows Hello unlock is on", {
        description: "Your master password is still needed after a restart and every 7 days.",
      });
      changed(path, next);
    } catch (err) {
      const ipc = toIpcError(err);
      setBusy(false);
      if (ipc.code === "quick_unlock_password_required") setAskPassword(true);
      else if (ipc.code === "quick_unlock_cancelled") setError("Windows Hello was cancelled. Nothing was changed.");
      else setError(ipc.message);
    }
  }

  return (
    <>
      <section
        aria-labelledby="hello-offer-title"
        className="fixed right-4 bottom-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-border-strong bg-popover/95 p-4 text-popover-foreground backdrop-blur-md transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0"
      >
        <div className="flex gap-3">
          <FingerprintIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="hello-offer-title" className="text-[13px] font-medium">
              Unlock faster with Windows Hello
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Use your Windows PIN, fingerprint or face on this PC instead of typing your master password each time.
              It is still asked for after a restart and every 7 days.
            </p>
            {!status.hardwareBacked && (
              <p className="text-[13px] leading-relaxed text-status-warning">
                This PC has no TPM, so Windows keeps the Hello key in software. Your master password stays the
                stronger lock.
              </p>
            )}
          </div>
        </div>
        <div aria-live="polite" className="text-[13px] text-status-risk empty:hidden">
          {error}
        </div>
        <div className="flex items-center justify-end gap-1">
          {!busy && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mr-auto text-muted-foreground"
                onClick={() => {
                  decline(true);
                }}
              >
                Don&apos;t ask again
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  decline(false);
                }}
              >
                Not now
              </Button>
            </>
          )}
          <Button type="button" size="sm" disabled={busy} onClick={() => void turnOn()}>
            {busy ? "Waiting for Windows Hello…" : "Turn on"}
          </Button>
        </div>
      </section>
      <QuickUnlockDialog
        kind="enable"
        open={askPassword}
        path={path}
        hardwareBacked={status.hardwareBacked}
        onClose={() => {
          setAskPassword(false);
        }}
      />
    </>
  );
}
