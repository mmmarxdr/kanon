import { createRoute, Outlet, redirect } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { CommandPalette } from "@/components/command-palette";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useDomainEvents } from "@/hooks/use-domain-events";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";

function AuthenticatedErrorFallback() {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0d0d0d)",
      }}
    >
      <div
        role="alert"
        style={{
          padding: "20px 28px",
          borderRadius: 7,
          border: "1px solid var(--bad, #f87171)",
          background: "var(--bg-2, #1a1a1a)",
          color: "var(--bad, #f87171)",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxWidth: 360,
        }}
      >
        <span style={{ fontWeight: 600 }}>Page failed to load</span>
        <span style={{ color: "var(--ink-3, #888)", fontSize: 11 }}>
          Reload or navigate to another page.
        </span>
      </div>
    </div>
  );
}

export const authenticatedRoute = createRoute({
  id: "_authenticated",
  getParentRoute: () => rootRoute,
  errorComponent: AuthenticatedErrorFallback,
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
        <EmailVerificationBanner />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Outlet />
        </div>
      </main>
      {isOpen && (
        <PanelErrorBoundary label="Command palette">
          <CommandPalette onClose={close} onCreateIssue={requestCreateIssue} />
        </PanelErrorBoundary>
      )}
    </div>
  );
}
