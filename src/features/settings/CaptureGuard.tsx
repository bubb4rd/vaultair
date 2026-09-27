import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { queryKeys, useAccount, useHealthIssues, useSessionConfig } from "@/app/queries";
import { accountSecurityFacts, securityScore } from "@/features/accounts/securityScore";
import { session, type SessionConfig } from "@/ipc/client";
import { accountIdFromPath, wantsWindowHidden } from "./capturePolicy";

/**
 * In Custom mode, hides the window only while an account at or below the
 * chosen rating is open. Always and Off are left to the saved policy.
 */
export function CaptureGuard() {
  const queryClient = useQueryClient();
  const config = useSessionConfig().data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const custom = config?.captureMode === "custom";
  const accountId = custom ? accountIdFromPath(pathname) : null;
  const account = useAccount(accountId ?? "", accountId !== null);
  const loaded = account.isSuccess ? account.data : undefined;
  const archived = loaded ? loaded.archivedAt !== null : null;
  const issues = useHealthIssues(null, null, accountId !== null && loaded !== undefined && archived === false);
  const ticket = useRef(0);
  const chain = useRef(Promise.resolve());
  const sent = useRef<boolean | null>(null);

  const scored =
    loaded && archived === false && issues.isSuccess
      ? securityScore(accountSecurityFacts(loaded, Array.isArray(issues.data) ? issues.data : [])).status
      : null;

  const wanted =
    config === undefined
      ? null
      : wantsWindowHidden({
          mode: config.captureMode,
          level: config.captureLevel,
          accountId,
          archived: accountId === null ? false : loaded === undefined ? null : archived,
          status: scored,
        });

  useEffect(() => {
    if (!config || wanted === null || wanted === config.captureProtection) {
      sent.current = wanted;
      return;
    }
    if (sent.current === wanted) return;
    sent.current = wanted;
    const mine = ++ticket.current;
    chain.current = chain.current
      .catch(() => undefined)
      .then(() => session.applyCapture(wanted))
      .then((next) => {
        if (mine === ticket.current) {
          queryClient.setQueryData<SessionConfig>(queryKeys.sessionConfig, next);
        }
      });
  }, [config, queryClient, wanted]);

  return null;
}
