import { Link } from "@tanstack/react-router";
import { DeviceMobileIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { StatusBadge, type Status } from "@/components/common/StatusBadge";
import type { ContactRole, MailboxSecurity, RecoveryDependency } from "@/ipc/client";

const MAILBOX: Record<MailboxSecurity, { status: Status; label: string }> = {
  no_mfa: { status: "risk", label: "Mailbox has no MFA" },
  not_in_vault: { status: "unknown", label: "Mailbox not in vault" },
  not_applicable: { status: "info", label: "Phone" },
  mfa_on: { status: "secure", label: "Mailbox has MFA" },
};

const ROLE: Partial<Record<ContactRole, string>> = {
  login_email: "Signs in with it",
  recovery_email: "Resets through it",
  recovery_phone: "Resets by text or call",
};

function Route({ dep }: { dep: RecoveryDependency }) {
  const mailbox = MAILBOX[dep.mailbox];
  const Icon = dep.contact.kind === "phone" ? DeviceMobileIcon : EnvelopeSimpleIcon;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
        <span className="min-w-0 text-[13px] font-medium break-all text-foreground">{dep.contact.value}</span>
        <StatusBadge status={mailbox.status} label={mailbox.label} />
      </div>
      <ul className="ml-6 flex flex-col gap-1" aria-label={`Accounts depending on ${dep.contact.value}`}>
        {dep.dependents.map((d) => (
          <li key={d.account.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <Link
              to="/accounts/$accountId"
              params={{ accountId: d.account.id }}
              className="truncate rounded-sm text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {d.account.title}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">{ROLE[d.role] ?? "Linked"}</span>
          </li>
        ))}
      </ul>
      {dep.mailboxAccounts.length > 0 && (
        <p className="ml-6 text-xs text-subtle-foreground">
          Mailbox:{" "}
          {dep.mailboxAccounts.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <Link
                to="/accounts/$accountId"
                params={{ accountId: m.id }}
                className="rounded-sm text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.title}
              </Link>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

/**
 * Which accounts could be reset through which email or phone, riskiest
 * first: a mailbox without MFA, then one Vaultair doesn't know about.
 */
export function RecoveryDependencies({ dependencies }: { dependencies: RecoveryDependency[] }) {
  return (
    <section aria-labelledby="deps-heading" className="rounded-lg border border-border bg-card px-4 pt-3 pb-1">
      <h2 id="deps-heading" className="text-[13px] font-semibold">
        Recovery dependencies
      </h2>
      <p className="pb-1 text-[13px] text-muted-foreground">
        Anyone who gets into one of these could reset the accounts listed under it.
      </p>
      {dependencies.length === 0 ? (
        <p className="py-3 text-[13px] text-subtle-foreground">
          None yet. Add a login or recovery email to this identity's accounts to see what depends on what.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {dependencies.map((d) => (
            <Route key={d.contact.id} dep={d} />
          ))}
        </ul>
      )}
    </section>
  );
}
