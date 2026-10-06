import { useState, type SubmitEvent } from "react";
import { useOpenVault, useVaultInfoUpdated } from "@/app/queries";
import { Field, FieldError, describedBy } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/features/identities/IdentityForm";
import { vaultNameError } from "@/features/onboarding/vaultName";
import { toast } from "@/features/toast/toast";
import { settings, toIpcError, type IdentityColor, type VaultInfo } from "@/ipc/client";
import { SettingsSection } from "./Section";

function ProfileForm({ vault }: { vault: VaultInfo }) {
  const updated = useVaultInfoUpdated();
  const [name, setName] = useState(vault.name);
  const [color, setColor] = useState<IdentityColor | null>(vault.color);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameError = touched ? vaultNameError(name) : null;
  const changed = name !== vault.name || color !== vault.color;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setTouched(true);
    if (saving || vaultNameError(name)) return;
    setSaving(true);
    setError(null);
    try {
      updated(await settings.updateProfile({ name, color }));
      toast.success("Vault updated");
    } catch (err) {
      setError(toIpcError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <Field
        id="vault-name"
        label="Vault name"
        help="Shown in the sidebar and used to name backups. The vault's folder keeps its name, so the lock screen still lists it by the folder."
        error={nameError}
      >
        <Input
          id="vault-name"
          value={name}
          disabled={saving}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy("vault-name", { help: true, error: Boolean(nameError) })}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            setTouched(true);
          }}
        />
      </Field>
      <div className="flex flex-col gap-2">
        {/* The radio group carries the name "Color" itself. */}
        <p aria-hidden="true" className="text-[13px] font-medium">
          Color
        </p>
        <ColorPicker value={color} name={name} group="vault-color" onChange={setColor} />
      </div>
      <div aria-live="polite" className="empty:hidden">
        {error && <FieldError>{error}</FieldError>}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={!changed || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** Settings > General: the vault's name and colour. */
export function GeneralSettings() {
  const vault = useOpenVault();
  if (!vault) return null;
  return (
    <SettingsSection id="general" title="General">
      {/* Re-mount with the saved values after a save or a different vault. */}
      <ProfileForm key={`${vault.vaultId}:${vault.name}:${vault.color ?? ""}`} vault={vault} />
    </SettingsSection>
  );
}
