import { Link } from "@tanstack/react-router";
import { PAGE_PATHS } from "@/app/nav";
import { SettingsSection } from "./Section";

/** Settings > Catalog: the platform and game lists are pages of their own. */
export function CatalogSettings() {
  return (
    <SettingsSection id="catalog" title="Catalog">
      <p className="text-[13px] text-muted-foreground">
        Add, rename and give login pages to the platforms and games your accounts use on the{" "}
        <Link to={PAGE_PATHS.platforms} className="text-foreground underline underline-offset-2 hover:text-brand">
          Platforms
        </Link>{" "}
        and{" "}
        <Link to={PAGE_PATHS.games} className="text-foreground underline underline-offset-2 hover:text-brand">
          Games
        </Link>{" "}
        pages.
      </p>
    </SettingsSection>
  );
}
