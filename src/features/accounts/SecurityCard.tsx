import type { ReactNode } from "react";
import { SealCheckIcon } from "@phosphor-icons/react";
import { useHealthIssues } from "@/app/queries";
import { Button } from "@/components/ui/button";
import type { AccountDetail } from "@/ipc/client";
import { SecurityDial } from "./SecurityDial";
import { formatDate, formatRelative } from "./labels";
import { accountSecurityFacts, securityScore } from "./securityScore";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="text-right text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The right-hand card: the score with the facts behind it, then when the
 * account was last checked and touched. Verifying is an action on the
 * score, so its button lives here.
 */
export function SecurityCard({ account, onVerify }: { account: AccountDetail; onVerify: () => void }) {
  const archived = account.archivedAt !== null;
  const issues = useHealthIssues(null, null, !archived);
  const result = securityScore(accountSecurityFacts(account, Array.isArray(issues.data) ? issues.data : null));
  const verified = formatDate(account.lastVerifiedAt);
  return (
    <aside
      aria-labelledby="security-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 pt-3 pb-4"
    >
      <h2 id="security-heading" className="text-[13px] font-semibold">
        Security
      </h2>
      {/* Side by side when the card sits under the details, stacked in the right column. */}
      <div className="grid gap-4 @max-4xl:grid-cols-2 @max-4xl:gap-x-8">
        <SecurityDial result={result} />
        <div className="flex flex-col gap-4 border-t border-border pt-4 @max-4xl:border-t-0 @max-4xl:border-l @max-4xl:pt-0 @max-4xl:pl-8">
          <dl className="flex flex-col gap-2.5">
            <Row label="Last verified">
              <span className={verified ? undefined : "text-subtle-foreground"}>{verified ?? "Never"}</span>
            </Row>
            <Row label="Last activity">{formatRelative(account.lastActivityAt)}</Row>
            <Row label="Added">{formatDate(account.createdAt)}</Row>
            <Row label="Last edited">{formatDate(account.updatedAt)}</Row>
          </dl>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={onVerify}>
            <SealCheckIcon aria-hidden="true" />
            Mark verified
          </Button>
        </div>
      </div>
    </aside>
  );
}
