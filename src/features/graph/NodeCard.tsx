import { EnvelopeSimpleIcon, LockKeyIcon, PhoneIcon } from "@phosphor-icons/react";
import { CatalogLogo } from "@/features/catalog/CatalogLogo";
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
 * or account's logo, or an icon for an email, phone or MFA method.
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

/** A node on the canvas: mark, label and kind on a card. The focus gets the accent edge and says so. */
export function NodeCard({ node, label, focus }: { node: GraphNode; label: string; focus: boolean }) {
  return (
    <span
      className={cn(
        "flex h-[52px] w-[224px] items-center gap-2.5 rounded-lg border bg-card px-2.5 text-left",
        focus ? "border-brand" : "border-border-strong",
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

/** Nodes with their own page open it. The rest (emails, phones, platforms, games) recentre the map. */
export type NodeTarget =
  | { type: "identity"; identityId: string }
  | { type: "account"; accountId: string; hash?: string }
  | { type: "focus"; focus: GraphFocus };

export function nodeTarget(node: GraphNode): NodeTarget {
  switch (node.kind) {
    case "identity":
      return { type: "identity", identityId: node.recordId };
    case "account":
      return { type: "account", accountId: node.recordId };
    case "mfa_method":
      return { type: "account", accountId: node.recordId, hash: "mfa-heading" };
    case "email":
    case "recovery_method":
      return { type: "focus", focus: { kind: "contact", id: node.recordId } };
    case "platform":
      return { type: "focus", focus: { kind: "platform", id: node.recordId } };
    case "game":
      return { type: "focus", focus: { kind: "game", id: node.recordId } };
  }
}

/** The focus that centres the map on this node, if it can be one. An MFA method can't. */
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
