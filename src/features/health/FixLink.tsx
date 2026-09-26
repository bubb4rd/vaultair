import { Link } from "@tanstack/react-router";
import type { HealthIssue } from "@/ipc/client";

/** Opens the screen where this issue is fixed. */
export function FixLink({ issue }: { issue: HealthIssue }) {
  const label = `Fix ${issue.title}`;
  const className =
    "shrink-0 rounded-sm text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring";
  if (issue.fix === "edit_account") {
    return (
      <Link
        to="/accounts/$accountId/edit"
        params={{ accountId: issue.accountId }}
        className={className}
        aria-label={label}
      >
        Fix
      </Link>
    );
  }
  if (issue.fix === "mfa_section") {
    return (
      <Link
        to="/accounts/$accountId"
        params={{ accountId: issue.accountId }}
        hash="mfa-heading"
        className={className}
        aria-label={label}
      >
        Fix
      </Link>
    );
  }
  return (
    <Link to="/accounts/$accountId" params={{ accountId: issue.accountId }} className={className} aria-label={label}>
      Fix
    </Link>
  );
}
