import { useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createAppRouter } from "./router";

export function App({ router: injected }: { router?: ReturnType<typeof createAppRouter> }) {
  const [router] = useState(() => injected ?? createAppRouter());
  return (
    <TooltipProvider delayDuration={400}>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
