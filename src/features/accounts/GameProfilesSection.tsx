import { useState, type SubmitEvent } from "react";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useAccounts, useCatalogChanged, useGameProfiles, useGames, usePlatforms } from "@/app/queries";
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
import { NativeSelect, Textarea } from "@/components/ui/textarea";
import { CatalogLogo } from "@/features/catalog/CatalogLogo";
import { toast } from "@/features/toast/toast";
import {
  gameProfiles,
  isIpcError,
  toIpcError,
  type AccountDetail,
  type GameProfileInput,
  type GameProfileView,
} from "@/ipc/client";

interface Draft {
  gameId: string;
  platformId: string;
  gamertag: string;
  playerId: string;
  region: string;
  rankTier: string;
  currentSeason: string;
  notes: string;
  linkedLauncherAccountId: string;
  linkedConsoleAccountId: string;
}

const MESSAGES: Record<string, string> = {
  gameId: "Choose the game.",
  platformId: "That platform no longer exists. Choose another one.",
  linkedLauncherAccountId: "Choose another account; a profile can't link to its own account.",
  linkedConsoleAccountId: "Choose another account; a profile can't link to its own account.",
  notes: "Notes can be up to 20,000 characters.",
};

function draftOf(account: AccountDetail, p: GameProfileView | null): Draft {
  return {
    gameId: p?.gameId ?? account.gameId ?? "",
    platformId: p?.platformId ?? (p ? "" : (account.platformId ?? "")),
    gamertag: p?.gamertag ?? "",
    playerId: p?.playerId ?? "",
    region: p?.region ?? "",
    rankTier: p?.rankTier ?? "",
    currentSeason: p?.currentSeason ?? "",
    notes: p?.notes ?? "",
    linkedLauncherAccountId: p?.linkedLauncherAccountId ?? "",
    linkedConsoleAccountId: p?.linkedConsoleAccountId ?? "",
  };
}

const opt = (s: string) => (s.trim() === "" ? null : s);

function toInput(d: Draft): GameProfileInput {
  return {
    gameId: d.gameId,
    platformId: opt(d.platformId),
    gamertag: opt(d.gamertag),
    playerId: opt(d.playerId),
    region: opt(d.region),
    rankTier: opt(d.rankTier),
    currentSeason: opt(d.currentSeason),
    notes: opt(d.notes),
    linkedLauncherAccountId: opt(d.linkedLauncherAccountId),
    linkedConsoleAccountId: opt(d.linkedConsoleAccountId),
  };
}

function TextInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </Field>
  );
}

function ProfileDialog({
  account,
  profile,
  open,
  onOpenChange,
}: {
  account: AccountDetail;
  profile: GameProfileView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const games = useGames();
  const platforms = usePlatforms();
  const others = (useAccounts(false).data ?? []).filter((a) => a.id !== account.id);
  const changed = useCatalogChanged();
  const [draft, setDraft] = useState(() => draftOf(account, profile));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!draft.gameId) {
      setErrors({ gameId: MESSAGES.gameId });
      document.getElementById("gp-gameId")?.focus();
      return;
    }
    setSaving(true);
    try {
      const input = toInput(draft);
      const saved = profile
        ? await gameProfiles.update(profile.id, input)
        : await gameProfiles.create(account.id, input);
      changed();
      toast.success(profile ? "Game profile saved" : "Game profile added", {
        description: saved.gamertag ?? saved.gameName,
      });
      onOpenChange(false);
    } catch (err) {
      const error = toIpcError(err);
      if (isIpcError(err) && error.code === "invalid_input" && error.field) {
        setErrors({ [error.field]: MESSAGES[error.field] ?? error.message });
        document.getElementById(`gp-${error.field}`)?.focus();
      } else {
        toast.error("Couldn't save the game profile", {
          description: error.message,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const accountSelect = (key: "linkedLauncherAccountId" | "linkedConsoleAccountId", label: string, help: string) => (
    <Field id={`gp-${key}`} label={label} help={help} error={errors[key]}>
      <NativeSelect
        id={`gp-${key}`}
        value={draft[key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(`gp-${key}`, {
          help: true,
          error: Boolean(errors[key]),
        })}
        onChange={(e) => {
          set(key, e.target.value);
        }}
      >
        <option value="">None</option>
        {others.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-popover">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{profile ? "Edit game profile" : "Add game profile"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              Who you are in one game on this account: gamertag, rank, and the launcher or console it's played through.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-2 gap-4 overflow-y-auto pr-1">
            <Field id="gp-gameId" label="Game" error={errors.gameId}>
              <NativeSelect
                id="gp-gameId"
                value={draft.gameId}
                aria-invalid={errors.gameId ? true : undefined}
                aria-describedby={describedBy("gp-gameId", {
                  error: Boolean(errors.gameId),
                })}
                onChange={(e) => {
                  set("gameId", e.target.value);
                }}
              >
                <option value="">Choose a game</option>
                {(games.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="gp-platformId" label="Played on" error={errors.platformId}>
              <NativeSelect
                id="gp-platformId"
                value={draft.platformId}
                aria-invalid={errors.platformId ? true : undefined}
                aria-describedby={describedBy("gp-platformId", {
                  error: Boolean(errors.platformId),
                })}
                onChange={(e) => {
                  set("platformId", e.target.value);
                }}
              >
                <option value="">Not recorded</option>
                {(platforms.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <TextInput
              id="gp-gamertag"
              label="Gamertag"
              placeholder="NightOwl#2231"
              value={draft.gamertag}
              onChange={(v) => {
                set("gamertag", v);
              }}
            />
            <TextInput
              id="gp-playerId"
              label="Player ID"
              value={draft.playerId}
              onChange={(v) => {
                set("playerId", v);
              }}
            />
            <TextInput
              id="gp-rankTier"
              label="Rank or tier"
              placeholder="Diamond 2"
              value={draft.rankTier}
              onChange={(v) => {
                set("rankTier", v);
              }}
            />
            <TextInput
              id="gp-currentSeason"
              label="Season"
              value={draft.currentSeason}
              onChange={(v) => {
                set("currentSeason", v);
              }}
            />
            <TextInput
              id="gp-region"
              label="Region or server"
              value={draft.region}
              onChange={(v) => {
                set("region", v);
              }}
            />
            <div />
            {accountSelect("linkedLauncherAccountId", "Launcher account", "The launcher you play it through.")}
            {accountSelect("linkedConsoleAccountId", "Console account", "The console network it's played on.")}
            <div className="col-span-2">
              <Field id="gp-notes" label="Notes" error={errors.notes}>
                <Textarea
                  id="gp-notes"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => {
                    set("notes", e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {profile ? "Save" : "Add profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfileRow({ account, profile }: { account: AccountDetail; profile: GameProfileView }) {
  const changed = useCatalogChanged();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = profile.gamertag ?? profile.gameName;
  const details = [
    profile.gamertag ? profile.gameName : null,
    profile.platformName,
    profile.rankTier,
    profile.currentSeason,
    profile.region,
  ].filter(Boolean);
  const links = [
    profile.linkedLauncherTitle && `via ${profile.linkedLauncherTitle}`,
    profile.linkedConsoleTitle && `on ${profile.linkedConsoleTitle}`,
  ].filter(Boolean);

  async function remove() {
    try {
      await gameProfiles.delete(profile.id);
      changed();
      toast.success("Game profile removed", { description: name });
    } catch (err) {
      toast.error("Couldn't remove it", {
        description: toIpcError(err).message,
      });
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <CatalogLogo icon={profile.gameIcon} name={profile.gameName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{[...details, ...links].join(" · ")}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${name}`}
        onClick={() => {
          setEditing(true);
        }}
      >
        <PencilSimpleIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${name}`}
        onClick={() => {
          setConfirmRemove(true);
        }}
      >
        <TrashIcon aria-hidden="true" />
      </Button>
      {editing && <ProfileDialog account={account} profile={profile} open={editing} onOpenChange={setEditing} />}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="max-w-sm bg-popover">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Remove this game profile?</DialogTitle>
            <DialogDescription className="text-[13px]">
              {name} is removed from this account. The account and the game stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                void remove();
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** The account's game profiles: gamertag, rank and season per game. */
export function GameProfilesSection({ account }: { account: AccountDetail }) {
  const list = useGameProfiles({
    accountId: account.id,
    gameId: null,
    platformId: null,
  });
  const [adding, setAdding] = useState(false);
  const profiles = list.data ?? [];
  return (
    <section aria-labelledby="profiles-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="profiles-heading" className="text-[13px] font-semibold">
          Game profiles
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add profile
        </Button>
      </div>
      {list.isPending ? null : profiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-[13px] text-muted-foreground">
          No game profiles. Add one for each game you play on this account, with its gamertag and rank.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {profiles.map((p) => (
            <ProfileRow key={p.id} account={account} profile={p} />
          ))}
        </ul>
      )}
      {adding && <ProfileDialog account={account} profile={null} open={adding} onOpenChange={setAdding} />}
    </section>
  );
}
