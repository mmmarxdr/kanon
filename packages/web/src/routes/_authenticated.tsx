import { createRoute, Outlet, redirect } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
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

    if (state.isAuthenticated && state.user) return;

    if (!state.isLoading) {
      await state.bootstrap();
    } else {
      await state.bootstrap();
    }

    const afterBootstrap = useAuthStore.getState();
    if (!afterBootstrap.isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { isOpen, close } = useCommandPalette();
  const requestCreateIssue = useCommandPaletteStore((s) => s.requestCreateIssue);
  const isLoading = useAuthStore((s) => s.isLoading);
  const activeWorkspaceId = useActiveWorkspaceId();

  useDomainEvents(activeWorkspaceId);

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <AppSidebar />
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <AppTopbar />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Outlet />
        </div>
      </main>
      {isOpen && (
        <CommandPalette onClose={close} onCreateIssue={requestCreateIssue} />
      )}
    </div>
  );
}
