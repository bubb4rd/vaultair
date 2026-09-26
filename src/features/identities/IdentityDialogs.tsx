import { useMemo, useState, type SubmitEvent } from "react";
import { MagnifyingGlassIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { useAccounts, useIdentityRefs } from "@/app/queries";
import { Field, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/textarea";
import { toast } from "@/features/toast/toast";
import { identities, toIpcError, type IdentityDeletePlan } from "@/ipc/client";
import { plural } from "./IdentitiesPage";

/**
 * Bulk assignment: every active account not already in this identity, with
 * a filter and checkboxes. Accounts in another identity say which, since
 * assigning moves them.
 */
export function AssignAccountsDialog({
  identity,
  open,
  onOpenChange,
  onAssigned,
}: {
  identity: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}) {
  const list = useAccounts(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? [])
      .filter((a) => a.identityId !== identity.id)
      .filter((a) => !q || [a.title, a.username, a.email].some((v) => v?.toLowerCase().includes(q)));
  }, [list.data, identity.id, query]);

  function change(next: boolean) {
    if (!next) {
      setQuery("");
      setSelected(new Set());
    }
    onOpenChange(next);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const n = await identities.assignAccounts(identity.id, [...selected]);
      toast.success(`${plural(n, "account")} assigned`, { description: identity.name });
      change(false);
      onAssigned();
    } catch (err) {
      toast.error("Couldn't assign the accounts", { description: toIpcError(err).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-lg bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Assign accounts to {identity.name}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              An account belongs to one identity. Choosing one that's in another identity moves it here.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
            />
            <Input
              type="search"
              aria-label="Filter accounts"
              placeholder="Filter by name, username or email"
              value={query}
              autoComplete="off"
              spellCheck={false}
              className="h-8 pl-9"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
          <fieldset className="max-h-72 overflow-y-auto rounded-md border border-border">
            <legend className="sr-only">Accounts</legend>
            {candidates.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                {list.data?.length ? "No other accounts match." : "There are no accounts to assign yet."}
              </p>
            ) : (
              candidates.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    className="size-4 accent-[var(--primary)]"
                    onChange={() => {
                      toggle(a.id);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{a.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[a.username ?? a.email, a.identityName && `In ${a.identityName}`].filter(Boolean).join(" · ") ||
                        a.purposeName}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={selected.size === 0 || busy}>
              {selected.size === 0 ? "Assign" : `Assign ${plural(selected.size, "account")}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Permanent delete. The accounts stay either way; the user decides whether
 * they move to another identity or are left without one, then types the
 * identity's name (Rust checks it too).
 */
export function DeleteIdentityDialog({
  identity,
  accountCount,
  open,
  onOpenChange,
  onDeleted,
}: {
  identity: { id: string; name: string };
  accountCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const refs = useIdentityRefs();
  const others = (refs.data ?? []).filter((r) => r.id !== identity.id);
  const [action, setAction] = useState<"unassign" | "reassign">("unassign");
  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === identity.name.trim();
  const reassigning = accountCount > 0 && action === "reassign";
  const targetId = target || others[0]?.id || "";

  function change(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
      setAction("unassign");
      setTarget("");
    }
    onOpenChange(next);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!matches) {
      setError("Type the identity name exactly as shown.");
      return;
    }
    const plan: IdentityDeletePlan = reassigning ? { action: "reassign", identityId: targetId } : { action: "unassign" };
    setBusy(true);
    try {
      await identities.delete(identity.id, typed, plan);
      change(false);
      toast.success("Identity deleted", { description: identity.name });
      onDeleted();
    } catch (err) {
      const e = toIpcError(err);
      setError(e.field === "confirmName" ? "Type the identity name exactly as shown." : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md bg-popover">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ShieldWarningIcon aria-hidden="true" weight="fill" className="size-5 text-status-risk" />
              Delete this identity permanently?
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Its description, notes and tags are removed. Accounts aren't deleted. Archive it instead if you might
              need it again.
            </DialogDescription>
          </DialogHeader>
          {accountCount > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-medium">
                What happens to its {plural(accountCount, "account")}?
              </legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="delete-action"
                  checked={action === "unassign"}
                  className="size-4 accent-[var(--primary)]"
                  onChange={() => {
                    setAction("unassign");
                  }}
                />
                Keep them without an identity
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="delete-action"
                  checked={action === "reassign"}
                  disabled={others.length === 0}
                  className="size-4 accent-[var(--primary)]"
                  onChange={() => {
                    setAction("reassign");
                  }}
                />
                Move them to another identity
                {others.length === 0 && <span className="text-subtle-foreground">(there are no others)</span>}
              </label>
              {reassigning && (
                <div className="ml-6">
                  <NativeSelect
                    aria-label="Move accounts to"
                    value={targetId}
                    onChange={(e) => {
                      setTarget(e.target.value);
                    }}
                  >
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </fieldset>
          )}
          <Field id="identity-delete-confirm" label={`Type “${identity.name}” to confirm`} error={error}>
            <Input
              id="identity-delete-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("identity-delete-confirm", { error: Boolean(error) })}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || busy}>
              Delete permanently
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
