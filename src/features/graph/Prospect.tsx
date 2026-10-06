import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  queryKeys,
  useAccountUpdated,
  useContactPoints,
  useIdentityRefs,
  usePlatforms,
  usePurposes,
} from "@/app/queries";
import { Button } from "@/components/ui/button";
import { mailboxFields } from "@/features/accounts/mailbox";
import { toast } from "@/features/toast/toast";
import { accounts, graph, toIpcError, type AccountInput, type GraphNode } from "@/ipc/client";

/**
 * What can be done with a prospective account: the mailbox behind an email
 * that accounts use while the vault has no account for it.
 */
export interface Prospects {
  /** Active accounts that sign in or recover with the address. 0 until that is known. */
  accountCount: (node: GraphNode) => number;
  /** Adds the mailbox as an account straight away, from what the address says. */
  add: (node: GraphNode) => void;
  /** Opens the new-account form filled in for the mailbox. */
  edit: (node: GraphNode) => void;
  /** Stops suggesting it. */
  discard: (node: GraphNode) => void;
  /** The node an add or discard is running for. */
  busy: string | null;
}

export function useProspects(labelOf: (node: GraphNode) => string): Prospects {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contacts = useContactPoints();
  const platforms = usePlatforms();
  const purposes = usePurposes();
  const refs = useIdentityRefs();
  const updated = useAccountUpdated();
  const [busy, setBusy] = useState<string | null>(null);

  const edit = (node: GraphNode) => {
    void navigate({ to: "/accounts/new", search: { mailbox: node.recordId } });
  };

  async function setDismissed(node: GraphNode, dismissed: boolean) {
    await graph.setProspectDismissed(node.recordId, dismissed);
    void queryClient.invalidateQueries({ queryKey: queryKeys.graph });
  }

  async function add(node: GraphNode) {
    const contact = contacts.data?.find((c) => c.id === node.recordId);
    const purposeId = purposes.data?.find((p) => !p.isHidden)?.id;
    // Without the address or a purpose to file it under, the form is the way in.
    if (!contact || !purposeId) {
      edit(node);
      return;
    }
    const fields = mailboxFields(contact.value, platforms.data ?? []);
    const owner = refs.data?.some((r) => r.id === contact.identityId) ? contact.identityId : null;
    const input: AccountInput = {
      title: fields.title,
      accountType: "email",
      purposeId,
      status: "active",
      identityId: owner,
      username: null,
      email: contact.value,
      password: { op: "unchanged" },
      recoveryEmail: null,
      recoveryPhone: null,
      websiteUrl: null,
      loginUrl: null,
      platformId: fields.platformId,
      gameId: null,
      publisher: fields.publisher,
      region: null,
      playerId: null,
      displayName: null,
      notes: null,
      sensitiveNotes: { op: "unchanged" },
      tags: [],
      customFields: [],
    };
    setBusy(node.id);
    try {
      const detail = await accounts.create(input);
      updated(detail);
      toast.success("Account added", {
        description: `${detail.title}. Open it to add its password.`,
        actions: [
          {
            label: "Open",
            onClick: () => {
              void navigate({ to: "/accounts/$accountId", params: { accountId: detail.id } });
            },
          },
        ],
      });
    } catch (err) {
      toast.error("Couldn't add the account", { description: toIpcError(err).message });
    } finally {
      setBusy(null);
    }
  }

  async function discard(node: GraphNode) {
    setBusy(node.id);
    try {
      await setDismissed(node, true);
      toast.info("Suggestion discarded", {
        description: labelOf(node),
        actions: [
          {
            label: "Undo",
            onClick: () => {
              setDismissed(node, false).catch((err: unknown) => {
                toast.error("Couldn't bring the suggestion back", { description: toIpcError(err).message });
              });
            },
          },
        ],
      });
    } catch (err) {
      toast.error("Couldn't discard the suggestion", { description: toIpcError(err).message });
    } finally {
      setBusy(null);
    }
  }

  return {
    accountCount: (node) => contacts.data?.find((c) => c.id === node.recordId)?.accountCount ?? 0,
    add: (node) => void add(node),
    edit,
    discard: (node) => void discard(node),
    busy,
  };
}

/** Why the map suggests it: who uses the address, and what is missing. */
export function prospectReason(count: number): string {
  const who = count === 1 ? "1 account uses" : count > 1 ? `${String(count)} accounts use` : "Accounts use";
  return `${who} this address, but the mailbox itself isn't in your vault.`;
}

/** The map's popover for a prospective account: what it is, then add, edit or discard. */
export function ProspectPanel({ node, label, prospects }: { node: GraphNode; label: string; prospects: Prospects }) {
  const busy = prospects.busy === node.id;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="truncate text-[13px] font-medium text-foreground">{label}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{prospectReason(prospects.accountCount(node))}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            prospects.add(node);
          }}
        >
          Add account
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            prospects.edit(node);
          }}
        >
          Edit first
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            prospects.discard(node);
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
