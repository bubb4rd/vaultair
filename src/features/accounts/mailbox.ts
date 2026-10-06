import { emailProvider } from "@/features/catalog/logos";
import type { PlatformView } from "@/ipc/client";

/**
 * How a new account for the mailbox behind `email` starts: named after its
 * provider and on that platform when the catalog knows the domain (the same
 * fill the account form makes from a typed address), otherwise named after
 * the domain.
 */
export function mailboxFields(email: string, platforms: PlatformView[]) {
  const provider = emailProvider(email);
  const platform = provider ? platforms.find((p) => p.id === provider.platformId) : undefined;
  const domain = email.trim().toLowerCase().split("@")[1];
  return {
    title: platform?.name ?? (domain || email),
    platformId: platform?.id ?? null,
    publisher: platform?.publisher ?? null,
  };
}
