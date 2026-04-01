import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "./index.css";
import { initializeTheme } from "./stores/theme-store";
import { initializeLocale } from "./stores/locale-store";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

// Provide QueryClient to the router context
router.update({
  context: {},
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

initializeTheme();
initializeLocale();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
