import { useEffect, useState } from "react";
import { appInfo, type AppInfo } from "@/ipc/client";
import { SettingsSection } from "./Section";

/** From the README's "Third-party content". Keep the two in step. */
const CREDITS = [
  {
    name: "EFF large wordlist",
    by: "Electronic Frontier Foundation",
    license: "CC BY 3.0 US",
    use: "Passphrases. Embedded unmodified.",
  },
  { name: "Simple Icons", by: "Simple Icons contributors", license: "CC0 1.0", use: "Platform and game logos." },
  { name: "dagre", by: "Chris Pettitt and contributors", license: "MIT", use: "Relationship map layout." },
  { name: "SQLCipher", by: "Zetetic", license: "BSD-style", use: "The encrypted database." },
  { name: "Geist", by: "Vercel", license: "SIL Open Font License 1.1", use: "The interface typeface." },
];

/** Settings > About: version, licence and credits. */
export function AboutSettings() {
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

  return (
    <SettingsSection id="about" title="About">
      {info && (
        <p data-testid="app-version" className="font-mono text-xs text-subtle-foreground">
          {info.name} {info.version}
          {info.buildProfile === "debug" ? " (debug build)" : ""}
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">Vaultair is free software, licensed under the GNU General Public License v3.0.</p>
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">Third-party content</h3>
        <ul className="flex flex-col gap-1.5" data-testid="credits">
          {CREDITS.map((c) => (
            <li key={c.name} className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">{c.name}</span> by {c.by}, {c.license}. {c.use}
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">
          Platform and game logos remain their owners&apos; trademarks and are used only to identify the service.
        </p>
      </div>
    </SettingsSection>
  );
}
