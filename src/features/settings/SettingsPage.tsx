import { BackupSettings } from "@/features/backup/BackupSettings";
import { PageHeader } from "@/features/shell/PageHeader";
import { AboutSettings } from "./About";
import { CatalogSettings } from "./Catalog";
import { DevPanel } from "./DevPanel";
import { GeneralSettings } from "./General";
import { PrivacySettings } from "./Privacy";
import { SecuritySettings } from "./Security";

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="flex max-w-xl flex-col gap-10">
          <GeneralSettings />
          <SecuritySettings />
          <PrivacySettings />
          <BackupSettings />
          <CatalogSettings />
          <AboutSettings />
          {import.meta.env.DEV && <DevPanel />}
        </div>
      </div>
    </>
  );
}
