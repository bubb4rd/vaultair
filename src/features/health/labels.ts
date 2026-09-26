import type { Status } from "@/components/common/StatusBadge";
import type { HealthRule, HealthSeverity } from "@/ipc/client";

export const HEALTH_RULES: HealthRule[] = ["weak", "reused", "missing_mfa", "missing_recovery_codes", "dormant"];

export function ruleLabel(rule: HealthRule): string {
  switch (rule) {
    case "weak":
      return "Weak password";
    case "reused":
      return "Reused password";
    case "missing_mfa":
      return "Missing MFA";
    case "missing_recovery_codes":
      return "Missing recovery codes";
    case "dormant":
      return "Dormant";
  }
}

/** High is red, medium orange, low yellow, dormant gray. Icon and label come with the color. */
export function severityStatus(severity: HealthSeverity): Status {
  switch (severity) {
    case "high":
      return "risk";
    case "medium":
      return "warning";
    case "low":
      return "attention";
    case "info":
      return "dormant";
  }
}
