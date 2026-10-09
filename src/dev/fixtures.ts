/**
 * Realistic vault data for the browser-only dashboard gallery. Dates are
 * relative to now so "2 hours ago" style labels stay sensible.
 */
import type {
  AccountDetail,
  AccountSummary,
  AccountType,
  BackupStatus,
  DashboardSummary,
  HealthIssue,
  HealthSummary,
  IdentityRef,
} from "@/ipc/client";

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

export const IDENTITIES: IdentityRef[] = [
  { id: "id-main", name: "Main", color: "blue" },
  { id: "id-comp", name: "Competitive alt", color: "violet" },
  { id: "id-creator", name: "Creator", color: "teal" },
];

interface Seed {
  id: string;
  title: string;
  type: AccountType;
  purpose: "Main" | "Alt";
  identity: IdentityRef | null;
  platform?: string;
  username?: string;
  email?: string;
  strength?: number;
  mfa?: boolean;
  codes?: number;
  favorite?: boolean;
  hoursAgo: number;
  tags?: string[];
}

function account(s: Seed): AccountSummary {
  return {
    id: s.id,
    title: s.title,
    accountType: s.type,
    purposeId: s.purpose === "Main" ? "p-main" : "p-alt",
    purposeName: s.purpose,
    status: "active",
    identityId: s.identity?.id ?? null,
    identityName: s.identity?.name ?? null,
    username: s.username ?? null,
    email: s.email ?? null,
    platformId: s.platform ? `pl-${s.platform.toLowerCase().replace(/\W+/g, "-")}` : null,
    platformName: s.platform ?? null,
    platformIcon: null,
    gameId: null,
    gameName: null,
    gameIcon: null,
    publisher: null,
    hasPassword: true,
    passwordStrength: s.strength ?? 4,
    mfaEnabled: s.mfa ?? true,
    backupCodesRemaining: s.codes ?? 8,
    favorite: s.favorite ?? false,
    favoritedAt: s.favorite ? ago(400) : null,
    archivedAt: null,
    tags: s.tags ?? [],
    updatedAt: ago(s.hoursAgo),
    lastActivityAt: ago(s.hoursAgo),
  };
}

const [main, comp, creator] = IDENTITIES as [IdentityRef, IdentityRef, IdentityRef];

export const ACCOUNTS: AccountSummary[] = [
  account({ id: "a-steam", title: "Steam", type: "platform", purpose: "Main", identity: main, platform: "Steam", username: "bubb4rd", favorite: true, hoursAgo: 1.5 }),
  account({ id: "a-discord", title: "Discord", type: "social", purpose: "Main", identity: main, platform: "Discord", username: "bubb4rd", favorite: true, hoursAgo: 5 }),
  account({ id: "a-riot-alt", title: "Riot Games (smurf)", type: "launcher", purpose: "Alt", identity: comp, platform: "Riot Games", username: "ghostpeak", strength: 1, mfa: false, hoursAgo: 9, tags: ["ranked"] }),
  account({ id: "a-twitch", title: "Twitch", type: "streaming", purpose: "Main", identity: creator, platform: "Twitch", username: "bubbardplays", favorite: true, codes: 0, hoursAgo: 26 }),
  account({ id: "a-epic", title: "Epic Games", type: "launcher", purpose: "Main", identity: main, platform: "Epic Games", email: "sam@proton.me", strength: 2, hoursAgo: 31 }),
  account({ id: "a-bnet", title: "Battle.net", type: "launcher", purpose: "Main", identity: main, platform: "Battle.net", username: "Bubbard#1142", favorite: true, hoursAgo: 52 }),
  account({ id: "a-proton", title: "Proton Mail", type: "email", purpose: "Main", identity: main, email: "sam@proton.me", favorite: true, hoursAgo: 70 }),
  account({ id: "a-xbox", title: "Xbox", type: "console", purpose: "Main", identity: main, platform: "Xbox", username: "Bubbard", mfa: false, hoursAgo: 96 }),
  account({ id: "a-yt-creator", title: "YouTube (channel)", type: "social", purpose: "Main", identity: creator, platform: "YouTube", email: "creator@proton.me", hoursAgo: 140 }),
  account({ id: "a-ea-alt", title: "EA App (alt)", type: "launcher", purpose: "Alt", identity: comp, platform: "EA", username: "ghostpeak2", strength: 1, mfa: false, hoursAgo: 2200 }),
];

const byId = (id: string): AccountSummary => {
  const found = ACCOUNTS.find((a) => a.id === id);
  if (!found) throw new Error(`fixture account missing: ${id}`);
  return found;
};

/**
 * One account in full, for the detail page. Built from its summary, so the
 * list and the page agree; the extra fields are plausible stand-ins.
 */
export function detailFor(id: string): AccountDetail | null {
  const s = ACCOUNTS.find((a) => a.id === id);
  if (!s) return null;
  const site = s.platformName ? `https://${s.platformName.toLowerCase().replace(/\W+/g, "")}.example.com` : null;
  const codes = s.backupCodesRemaining;
  return {
    ...s,
    gameName: s.id === "a-bnet" ? "Call of Duty" : s.gameName,
    recoveryEmail: s.email ? null : "recovery@example.com",
    recoveryPhone: null,
    passwordChangedAt: ago(24 * 40),
    websiteUrl: site,
    loginUrl: site ? `${site}/login` : null,
    catalogLoginUrl: null,
    region: null,
    playerId: null,
    displayName: null,
    notes: "Main library account. Family sharing is on.",
    hasSensitiveNotes: true,
    notesSuggestions: { identifiers: false, credentials: false, backupCodes: false, securityAnswers: false },
    lastVerifiedAt: s.favorite ? ago(24 * 12) : null,
    createdAt: ago(24 * 400),
    customFields: [],
    mfa: s.mfaEnabled
      ? [
          {
            id: `m-${s.id}`,
            method: "authenticator_app",
            enabled: true,
            hasTotp: true,
            backupCodes: Array.from({ length: 8 }, (_, index) => ({ index, used: index >= codes })),
            backupCodesRemaining: codes,
            backupCodesUpdatedAt: ago(24 * 100),
            hasRecoveryInstructions: false,
            notes: null,
            updatedAt: ago(24 * 100),
          },
        ]
      : [],
  };
}

export const ISSUES: HealthIssue[] = [
  { accountId: "a-riot-alt", title: "Riot Games (smurf)", rule: "weak", severity: "high", reason: "Password strength is Very weak", fix: "edit_account" },
  { accountId: "a-epic", title: "Epic Games", rule: "reused", severity: "high", reason: "Shares a password with Xbox", fix: "edit_account" },
  { accountId: "a-xbox", title: "Xbox", rule: "missing_mfa", severity: "medium", reason: "No MFA method is enabled", fix: "mfa_section" },
  { accountId: "a-twitch", title: "Twitch", rule: "missing_recovery_codes", severity: "low", reason: "No backup codes are left", fix: "mfa_section" },
  { accountId: "a-ea-alt", title: "EA App (alt)", rule: "dormant", severity: "info", reason: "No activity for 92 days", fix: "account" },
];

export const HEALTH: HealthSummary = {
  identityId: null,
  weak: 3,
  reused: 4,
  missingMfa: 6,
  missingRecoveryCodes: 2,
  dormant: 7,
};

/** The gallery vault was created 75 days ago. */
export const VAULT_CREATED_AT = ago(24 * 75);

/**
 * When each of the 44 accounts was added, oldest first: twenty on the day
 * the vault was created (an evening of typing in old logins), then a couple
 * a week. Two of them are archived, so this is longer than `totalAccounts`.
 */
const ACCOUNTS_CREATED_AT = Array.from({ length: 44 }, (_, i) => ago(24 * 75 - (i < 20 ? 1 + i * 0.1 : 24 + (i - 20) * 72)));

export const SUMMARY: DashboardSummary = {
  identityId: null,
  totalAccounts: 42,
  mainAccounts: 27,
  altAccounts: 15,
  identities: 3,
  missingMfa: HEALTH.missingMfa,
  favorites: 5,
  recent: ["a-steam", "a-discord", "a-riot-alt", "a-twitch", "a-epic"].map(byId),
  weak: HEALTH.weak,
  reused: HEALTH.reused,
  missingRecoveryCodes: HEALTH.missingRecoveryCodes,
  dormant: HEALTH.dormant,
  needsAttention: ISSUES,
  accountsCreatedAt: ACCOUNTS_CREATED_AT,
};

/** The same vault narrowed to one identity, so the filter has something to show. */
export function summaryFor(identityId: string | null): DashboardSummary {
  if (identityId === null) return SUMMARY;
  const recent = ACCOUNTS.filter((a) => a.identityId === identityId).slice(0, 5);
  const needsAttention = ISSUES.filter((i) => byId(i.accountId).identityId === identityId);
  const scale = identityId === "id-main" ? 0.6 : 0.2;
  const n = (v: number) => Math.round(v * scale);
  return {
    identityId,
    totalAccounts: n(SUMMARY.totalAccounts),
    mainAccounts: n(SUMMARY.mainAccounts),
    altAccounts: n(SUMMARY.altAccounts),
    identities: 1,
    missingMfa: n(SUMMARY.missingMfa),
    favorites: n(SUMMARY.favorites),
    recent,
    weak: n(SUMMARY.weak),
    reused: n(SUMMARY.reused),
    missingRecoveryCodes: n(SUMMARY.missingRecoveryCodes),
    dormant: n(SUMMARY.dormant),
    needsAttention,
    // Every account whose index crosses a step of `scale`, so the subset keeps the same shape.
    accountsCreatedAt: ACCOUNTS_CREATED_AT.filter((_, i) => Math.floor((i + 1) * scale) > Math.floor(i * scale)),
  };
}

export const BACKUP: BackupStatus = {
  destination: "D:\\Backups\\Vaultair",
  destinationAvailable: true,
  cloudProvider: null,
  lastBackupAt: ago(30),
  lastBackupPath: "D:\\Backups\\Vaultair\\Main-20261006-090000.vaultair-backup",
  lastOutcome: null,
  lastAttemptAt: ago(30),
  reminderDue: false,
  reminderAfterDays: 7,
};
