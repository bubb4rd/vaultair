import { useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/common/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VaultGate } from "./lock-guard";
import { createQueryClient } from "./queries";
import { createAppRouter } from "./router";

interface AppProps {
  router?: ReturnType<typeof createAppRouter>;
  queryClient?: QueryClient;
}

export function App({ router: injectedRouter, queryClient: injectedClient }: AppProps) {
  const [router] = useState(() => injectedRouter ?? createAppRouter());
  const [queryClient] = useState(() => injectedClient ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <VaultGate router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
