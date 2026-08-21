import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-local-capture-activity", () => ({
  useLocalCaptureActivity: captureSpy,
}));
vi.mock("@/hooks/use-domain-events", () => ({ useDomainEvents: vi.fn() }));
vi.mock("@/hooks/use-workspace-query", () => ({ useActiveWorkspaceId: () => "22222222-2222-4222-8222-222222222222" }));
vi.mock("@/hooks/use-command-palette", () => ({ useCommandPalette: () => ({ isOpen: false, close: vi.fn() }) }));
vi.mock("@/stores/command-palette-store", () => ({ useCommandPaletteStore: () => vi.fn() }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/app-topbar", () => ({ AppTopbar: () => null }));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/email-verification-banner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/components/panel-error-boundary", () => ({ PanelErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, Outlet: () => <div data-testid="outlet" /> };
});

import { useAuthStore } from "@/stores/auth-store";
import { AuthenticatedLayout } from "../_authenticated";

describe("authenticated work-capture composition", () => {
  beforeEach(() => {
    captureSpy.mockReset();
    useAuthStore.setState({
      user: {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "a@example.com",
        displayName: "A",
        avatarUrl: null,
        emailVerified: true,
        isSuperAdmin: false,
        isInstanceAdmin: false,
      },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it("hydrates capture state with the authenticated principal and active workspace", () => {
    render(<AuthenticatedLayout />);
    expect(captureSpy).toHaveBeenCalledWith({
      principalId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
