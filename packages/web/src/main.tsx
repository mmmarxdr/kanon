import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { initSentry } from "./lib/sentry";
import "./stores/theme-store"; // applies persisted theme on load
import "./index.css";

// No-ops unless VITE_SENTRY_DSN is set.
initSentry(router);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Provide QueryClient to the router context
router.update({
  context: {},
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl, {
  // React 19 root-level error reporting → Sentry. onCaughtError fires for
  // errors caught by an error boundary (e.g. the router's default one), which
  // is exactly where the prod white-screens land (see KAN-90). The handlers
  // no-op when Sentry is not initialized.
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
