import type { Icon } from "@phosphor-icons/react";
import {
  AppWindowIcon,
  BroadcastIcon,
  ChatsCircleIcon,
  CubeIcon,
  DeviceMobileIcon,
  EnvelopeSimpleIcon,
  GameControllerIcon,
  GlobeIcon,
  RocketLaunchIcon,
  TelevisionSimpleIcon,
} from "@phosphor-icons/react";
import type { Status } from "@/components/common/StatusBadge";
import type { AccountStatus, AccountType, CustomFieldType, MfaMethod } from "@/ipc/client";

export const ACCOUNT_TYPES: { value: AccountType; label: string; icon: Icon }[] = [
  { value: "launcher", label: "Launcher", icon: RocketLaunchIcon },
  { value: "game", label: "Game", icon: GameControllerIcon },
  { value: "platform", label: "Platform", icon: AppWindowIcon },
  { value: "console", label: "Console", icon: TelevisionSimpleIcon },
  { value: "social", label: "Social", icon: ChatsCircleIcon },
  { value: "streaming", label: "Streaming", icon: BroadcastIcon },
  { value: "email", label: "Email", icon: EnvelopeSimpleIcon },
  { value: "website", label: "Website", icon: GlobeIcon },
  { value: "app", label: "App", icon: DeviceMobileIcon },
  { value: "other", label: "Other", icon: CubeIcon },
];

export function accountType(value: AccountType) {
  return ACCOUNT_TYPES.find((t) => t.value === value) ?? { value, label: "Other", icon: CubeIcon };
}

/**
 * Account status as a badge. Colours follow the spec's status palette
 * (green active, grey dormant or retired, orange locked, red suspended).
 * "Archived" is a separate action, so the form doesn't offer it as a status.
 */
export const ACCOUNT_STATUSES: { value: AccountStatus; label: string; badge: Status }[] = [
  { value: "active", label: "Active", badge: "secure" },
  { value: "dormant", label: "Dormant", badge: "dormant" },
  { value: "locked", label: "Locked", badge: "warning" },
  { value: "suspended", label: "Suspended", badge: "risk" },
  { value: "retired", label: "Retired", badge: "archived" },
  { value: "archived", label: "Archived", badge: "archived" },
  { value: "unknown", label: "Unknown", badge: "unknown" },
];

export const FORM_STATUSES = ACCOUNT_STATUSES.filter((s) => s.value !== "archived");

export function accountStatus(value: AccountStatus) {
  return ACCOUNT_STATUSES.find((s) => s.value === value) ?? { value, label: "Unknown", badge: "unknown" as Status };
}

export const MFA_METHODS: { value: MfaMethod; label: string }[] = [
  { value: "authenticator_app", label: "Authenticator app" },
  { value: "totp", label: "TOTP code" },
  { value: "hardware_key", label: "Security key" },
  { value: "sms", label: "Text message" },
  { value: "email", label: "Email code" },
  { value: "recovery_codes_only", label: "Recovery codes only" },
  { value: "unknown", label: "Unknown" },
];

export function mfaMethodLabel(value: MfaMethod) {
  return MFA_METHODS.find((m) => m.value === value)?.label ?? "Unknown";
}

/** Methods whose second factor is a code Vaultair can generate. */
export function usesTotp(method: MfaMethod) {
  return method === "authenticator_app" || method === "totp";
}

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "secret", label: "Hidden" },
  { value: "url", label: "Link" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];

const STRENGTH = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;

/** zxcvbn 0–4 as words, and the status it maps to. */
export function passwordStrength(score: number): { label: string; status: Status } {
  const s = Math.min(Math.max(Math.round(score), 0), 4);
  const status: Status = s <= 1 ? "risk" : s === 2 ? "warning" : "secure";
  return { label: STRENGTH[s] ?? "Very weak", status };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

/** "12 Mar 2026" in the user's locale. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFormat.format(d);
}

/** "Today", "Yesterday", "3 days ago", or a date for anything older than a month. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${String(days)} days ago`;
  return formatDate(iso) ?? "";
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
