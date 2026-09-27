import type { Status } from "@/components/common/StatusBadge";
import { severityStatus } from "@/features/health/labels";
import type { HealthIssue, HealthRule } from "@/ipc/client";
import { formatDate, passwordStrength } from "./labels";

/**
 * One fact on the security dial. A health issue that restates the fact
 * (weak password, missing MFA, missing recovery codes) folds in here
 * instead of becoming a second chip.
 */
export interface SecurityChip {
  key: string;
  status: Status;
  label: string;
  /** Muted aside, such as "Changed Sep 25, 2026". */
  detail?: string;
  /** Reason from a health issue folded into this chip, or the issue itself. */
  reason?: string;
  /** Present when the chip can offer the issue's Fix link. */
  issue?: HealthIssue;
}

export interface SecurityFacts {
  archived: boolean;
  passwordStrength: number | null;
  passwordChangedAt: string | null;
  /** Enabled MFA methods. */
  mfaEnabled: number;
  /** Recorded MFA methods, including ones that are turned off. */
  mfaRecorded: number;
  /** Unused backup codes on enabled methods. */
  backupCodesRemaining: number;
  /**
   * Issues for this account. `null` while they are still loading: reuse
   * stays out of the score until they arrive.
   */
  issues: HealthIssue[] | null;
}

export interface SecurityScoreResult {
  /** Null when the account is archived and left out of security checks. */
  score: number | null;
  status: Status;
  label: string;
  chips: SecurityChip[];
}

const PASSWORD_DEDUCTION = [40, 32, 18, 8, 0] as const;

/** zxcvbn 0–4, clamped. `null` means no password is saved. */
function passwordDeduction(strength: number | null): number {
  if (strength === null) return 40;
  const score = Math.min(Math.max(Math.round(strength), 0), 4);
  return PASSWORD_DEDUCTION[score] ?? 40;
}

function band(score: number): { status: Status; label: string } {
  if (score >= 90) return { status: "secure", label: "Secure" };
  if (score >= 70) return { status: "attention", label: "Needs attention" };
  if (score >= 40) return { status: "warning", label: "Warning" };
  return { status: "risk", label: "High risk" };
}

function findIssue(issues: HealthIssue[] | null, rule: HealthRule): HealthIssue | undefined {
  return issues?.find((issue) => issue.rule === rule);
}

function passwordChip(facts: SecurityFacts): SecurityChip {
  const changed = formatDate(facts.passwordChangedAt);
  const weak = findIssue(facts.issues, "weak");
  if (facts.passwordStrength === null) {
    return {
      key: "password",
      status: "unknown",
      label: "No password saved",
      ...(changed ? { detail: `Changed ${changed}` } : {}),
      ...(weak ? { reason: weak.reason, issue: weak } : {}),
    };
  }
  const strength = passwordStrength(facts.passwordStrength);
  return {
    key: "password",
    status: strength.status,
    label: strength.label,
    ...(changed ? { detail: `Changed ${changed}` } : {}),
    ...(weak ? { reason: weak.reason, issue: weak } : {}),
  };
}

function mfaChip(facts: SecurityFacts): SecurityChip {
  const missing = findIssue(facts.issues, "missing_mfa");
  const recorded = facts.mfaRecorded > 0;
  const on = facts.mfaEnabled > 0;
  return {
    key: "mfa",
    status: on ? "secure" : "warning",
    label: on ? "On" : recorded ? "Turned off" : "Not recorded",
    ...(missing ? { reason: missing.reason, issue: missing } : {}),
  };
}

function backupChip(facts: SecurityFacts): SecurityChip {
  const missing = findIssue(facts.issues, "missing_recovery_codes");
  const folded = missing ? { reason: missing.reason, issue: missing } : {};
  if (facts.mfaEnabled === 0) {
    return { key: "backup", status: "unknown", label: "Not set", ...folded };
  }
  if (facts.backupCodesRemaining > 0) {
    return { key: "backup", status: "secure", label: `${String(facts.backupCodesRemaining)} left`, ...folded };
  }
  return { key: "backup", status: "attention", label: "None saved", ...folded };
}

/** Facts for one account. `issues` is null while health checks are still loading. */
export function accountSecurityFacts(
  account: {
    id: string;
    archivedAt: string | null;
    passwordStrength: number | null;
    passwordChangedAt: string | null;
    mfa: readonly { enabled: boolean; backupCodesRemaining: number }[];
  },
  issues: HealthIssue[] | null,
): SecurityFacts {
  const enabled = account.mfa.filter((method) => method.enabled);
  return {
    archived: account.archivedAt !== null,
    passwordStrength: account.passwordStrength,
    passwordChangedAt: account.passwordChangedAt,
    mfaEnabled: enabled.length,
    mfaRecorded: account.mfa.length,
    backupCodesRemaining: enabled.reduce((count, method) => count + method.backupCodesRemaining, 0),
    issues: issues?.filter((issue) => issue.accountId === account.id) ?? null,
  };
}

/**
 * Composite of password strength, MFA, backup codes, and reuse.
 * Deductions that a health issue only restates are applied once.
 * Archived accounts are not scored.
 */
export function securityScore(facts: SecurityFacts): SecurityScoreResult {
  const local: SecurityFacts = facts.archived ? { ...facts, issues: [] } : facts;
  const chips = [passwordChip(local), mfaChip(local), backupChip(local)];
  if (facts.archived) {
    return { score: null, status: "archived", label: "Not scored", chips };
  }

  const mfaOff = facts.mfaEnabled === 0;
  const noCodes = !mfaOff && facts.backupCodesRemaining === 0;
  const reused = findIssue(facts.issues, "reused");
  const dormant = findIssue(facts.issues, "dormant");
  if (reused) {
    chips.push({
      key: "reused",
      status: severityStatus(reused.severity),
      label: "Reused password",
      reason: reused.reason,
      issue: reused,
    });
  }
  if (dormant) {
    chips.push({
      key: "dormant",
      status: severityStatus(dormant.severity),
      label: "Dormant",
      reason: dormant.reason,
      issue: dormant,
    });
  }

  const score = Math.min(
    100,
    Math.max(0, 100 - passwordDeduction(facts.passwordStrength) - (mfaOff ? 35 : 0) - (noCodes ? 12 : 0) - (reused ? 30 : 0)),
  );
  return { score, ...band(score), chips };
}
