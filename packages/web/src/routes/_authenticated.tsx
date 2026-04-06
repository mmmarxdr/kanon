import { createRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useDomainEvents } from "@/hooks/use-domain-events";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";

export const authenticatedRoute = createRoute({
  id: "_authenticated",
  getParentRoute: () => rootRoute,
  beforeLoad: async () => {
    const state = useAuthStore.getState();

    // If already authenticated, proceed
    if (state.isAuthenticated && state.user) {
      return;
    }

    // If not loading yet (first visit or after clear), try bootstrap
    if (!state.isLoading) {
      await state.bootstrap();
    } else {
      // Bootstrap is already running (isLoading=true on init), wait for it
      await state.bootstrap();
    }

    // After bootstrap, check if we have a user
    const afterBootstrap = useAuthStore.getState();
    if (!afterBootstrap.isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { isOpen, close } = useCommandPalette();
  const requestCreateIssue = useCommandPaletteStore(
    (s) => s.requestCreateIssue,
  );
  const isLoading = useAuthStore((s) => s.isLoading);
  const activeWorkspaceId = useActiveWorkspaceId();

  // Connect to workspace-scoped SSE for real-time cache invalidation
  useDomainEvents(activeWorkspaceId);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      {isOpen && (
        <CommandPalette onClose={close} onCreateIssue={requestCreateIssue} />
      )}
    </div>
  );
}
