import { EnvelopeSimpleIcon, LockKeyIcon, PhoneIcon, PlusIcon } from "@phosphor-icons/react";
import { CatalogLogo } from "@/features/catalog/CatalogLogo";
import { emailProvider } from "@/features/catalog/logos";
import { IdentityAvatar } from "@/features/identities/IdentityAvatar";
import type { GraphFocus, GraphNode } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { kindLabel } from "./labels";

const TILE = {
  xs: "size-6 rounded [&>svg]:size-3.5",
  sm: "size-8 rounded-md [&>svg]:size-4",
} as const;

/**
 * What a node is, at a glance: an identity's initials, a platform's, game's
 * or account's logo, or an icon for an email, phone or MFA method. A
 * prospective account gets its provider's logo, dimmed, when the address
 * shows it, and a plus otherwise.
 * Decorative: the label and kind are always written next to it.
 */
export function NodeMark({ node, label, size = "sm" }: { node: GraphNode; label: string; size?: keyof typeof TILE }) {
  switch (node.kind) {
    case "identity":
      return <IdentityAvatar name={label} color={node.color} size={size} />;
    case "account":
    case "platform":
    case "game":
      return <CatalogLogo icon={node.icon} name={label} size={size} />;
    case "prospective_account": {
      // From the label on screen, so a hidden address doesn't give its provider away.
      const provider = emailProvider(label);
      if (provider) return <CatalogLogo icon={provider.icon} name={label} size={size} className="opacity-60" />;
      return (
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center border border-dashed border-input text-muted-foreground",
            TILE[size],
          )}
        >
          <PlusIcon />
        </span>
      );
    }
    case "email":
    case "recovery_method":
    case "mfa_method": {
      const Icon = node.kind === "email" ? EnvelopeSimpleIcon : node.kind === "mfa_method" ? LockKeyIcon : PhoneIcon;
      return (
        <span
          aria-hidden="true"
          className={cn("grid shrink-0 place-items-center bg-muted text-muted-foreground", TILE[size])}
        >
          <Icon />
        </span>
      );
    }
  }
}

/** "Account, Main" for an account with a purpose; otherwise the kind. */
export function nodeCaption(node: GraphNode): string {
  return node.detail ? `${kindLabel(node.kind)}, ${node.detail}` : kindLabel(node.kind);
}

/**
 * A node on the canvas: mark, label and kind on a card. The focus gets the
 * accent edge and says so. A prospective account is outlined in dashes: it
 * isn't in the vault.
 */
export function NodeCard({ node, label, focus }: { node: GraphNode; label: string; focus: boolean }) {
  const prospect = node.kind === "prospective_account";
  return (
    <span
      className={cn(
        "flex h-[52px] w-[224px] items-center gap-2.5 rounded-lg border px-2.5 text-left",
        prospect ? "border-dashed border-input bg-background" : "bg-card",
        !prospect && (focus ? "border-brand" : "border-border-strong"),
      )}
    >
      <NodeMark node={node} label={label} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5 font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs leading-4 text-muted-foreground">
          {nodeCaption(node)}
          {focus && <span className="sr-only">, the focus</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * Nodes with their own page open it. Emails, phones, platforms and games
 * recentre the map. A prospective account has neither: it offers to be
 * added, edited first or discarded.
 */
export type NodeTarget =
  | { type: "identity"; identityId: string }
  | { type: "account"; accountId: string; hash?: string }
  | { type: "focus"; focus: GraphFocus }
  | { type: "prospect"; contactId: string };

export function nodeTarget(node: GraphNode): NodeTarget {
  switch (node.kind) {
    case "identity":
      return { type: "identity", identityId: node.recordId };
    case "account":
      return { type: "account", accountId: node.recordId };
    case "mfa_method":
      return { type: "account", accountId: node.recordId, hash: "mfa-heading" };
    case "prospective_account":
      return { type: "prospect", contactId: node.recordId };
    case "email":
    case "recovery_method":
      return { type: "focus", focus: { kind: "contact", id: node.recordId } };
    case "platform":
      return { type: "focus", focus: { kind: "platform", id: node.recordId } };
    case "game":
      return { type: "focus", focus: { kind: "game", id: node.recordId } };
  }
}

/** The focus that centres the map on this node, if it can be one. An MFA method and a prospective account can't. */
export function focusOf(node: GraphNode): GraphFocus | null {
  switch (node.kind) {
    case "identity":
      return { kind: "identity", id: node.recordId };
    case "account":
      return { kind: "account", id: node.recordId };
    case "mfa_method":
      return null;
    default: {
      const target = nodeTarget(node);
      return target.type === "focus" ? target.focus : null;
    }
  }
}
