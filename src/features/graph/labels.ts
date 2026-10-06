import type { EdgeKind, NodeKind } from "@/ipc/client";

export function kindLabel(kind: NodeKind): string {
  switch (kind) {
    case "identity":
      return "Identity";
    case "email":
      return "Email";
    case "recovery_method":
      return "Recovery method";
    case "account":
      return "Account";
    case "prospective_account":
      return "Suggested account";
    case "platform":
      return "Platform";
    case "game":
      return "Game";
    case "mfa_method":
      return "MFA method";
  }
}

/** Names the relationship itself, so it reads the same from either end. */
export function edgeLabel(kind: EdgeKind): string {
  switch (kind) {
    case "owns":
      return "Assigned";
    case "primary_email":
      return "Primary email";
    case "recovery_email":
      return "Recovery email";
    case "phone":
      return "Phone";
    case "login_email":
      return "Sign-in email";
    case "recovery_phone":
      return "Recovery phone";
    case "linked_launcher":
      return "Linked launcher";
    case "linked_console":
      return "Linked console";
    case "on_platform":
      return "Platform";
    case "plays":
      return "Game";
    case "mfa":
      return "MFA";
    case "prospective":
      return "Mailbox";
  }
}

/** Relationships drawn with the same line. The line style is the signal; every edge also carries its label. */
export type EdgeFamily = "sign_in" | "recovery" | "linked" | "uses" | "suggested";

export function edgeFamily(kind: EdgeKind): EdgeFamily {
  switch (kind) {
    case "owns":
    case "primary_email":
    case "login_email":
      return "sign_in";
    case "recovery_email":
    case "phone":
    case "recovery_phone":
      return "recovery";
    case "linked_launcher":
    case "linked_console":
      return "linked";
    case "on_platform":
    case "plays":
    case "mfa":
      return "uses";
    case "prospective":
      return "suggested";
  }
}

export const EDGE_FAMILIES: { family: EdgeFamily; label: string; dash: string | undefined }[] = [
  { family: "sign_in", label: "Assigned or signs in with", dash: undefined },
  { family: "recovery", label: "Recovers through", dash: "6 4" },
  { family: "linked", label: "Linked account", dash: "10 3 2 3" },
  { family: "uses", label: "Platform, game or MFA", dash: "1 4" },
  // Dots in pairs: an account the vault doesn't have yet.
  { family: "suggested", label: "Suggested, not in vault", dash: "1 4 1 10" },
];

export function familyDash(family: EdgeFamily): string | undefined {
  return EDGE_FAMILIES.find((f) => f.family === family)?.dash;
}
