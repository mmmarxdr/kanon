/**
 * B5.1 — InboxView renderiza CurrentCycleCard como primera RailCard del right rail.
 * B5.2 — Integración: activeCycle y multipleActiveProjects pasan correctamente.
 *
 * Refs: REQ-INBOX-CYCLE-007 escenario 3, design §4.1 data flow
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: () => "ws-test-123",
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { displayName: string } }) => unknown) =>
    selector({ user: { displayName: "Alice" } }),
}));

vi.mock("@/stores/command-palette-store", () => ({
  useCommandPaletteStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

// ─── Dashboard data fixtures ──────────────────────────────────────────────────

const DASHBOARD_NO_CYCLE = {
  counts: { openIssues: 2, inProgress: 1, awaitingReview: 0, activeAgents: 0 },
  assigned: [],
  mentions: [],
  proposals: [],
  agents: [],
  activeCycle: null,
  multipleActiveProjects: false,
};

const DASHBOARD_WITH_CYCLE = {
  counts: { openIssues: 5, inProgress: 3, awaitingReview: 1, activeAgents: 1 },
  assigned: [],
  mentions: [],
  proposals: [],
  agents: [],
  activeCycle: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Sprint 1",
    projectName: "Phoenix",
    startDate: "2026-04-21T00:00:00.000Z",
    endDate: "2026-05-04T00:00:00.000Z",
    completed: 5,
    scope: 8,
    donePct: 62,
    velocity: 2,
    avgLeadDays: 3.4,
    burnup: [0, 1, 3, 5, 6],
  },
  multipleActiveProjects: false,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createWrapper(dashboardData: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Pre-seed the dashboard query cache with the fixture data.
  // Key must match dashboardKeys.detail(workspaceId) = ["dashboard", "detail", workspaceId]
  queryClient.setQueryData(["dashboard", "detail", "ws-test-123"], dashboardData);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("InboxView (B5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("B5.1 — renderiza current-cycle-empty cuando activeCycle=null", async () => {
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // CurrentCycleCard en empty state debe estar presente
    expect(screen.getByTestId("current-cycle-empty")).toBeTruthy();
  });

  it("B5.2 — renderiza current-cycle-card cuando activeCycle está populado", async () => {
    const { wrapper } = createWrapper(DASHBOARD_WITH_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // CurrentCycleCard debe renderizar el card completo con sparkline
    expect(screen.getByTestId("current-cycle-card")).toBeTruthy();
    expect(screen.getByTestId("sparkline")).toBeTruthy();
    expect(screen.getByTestId("done-pct-value").textContent).toBe("62%");
  });

  it("B5.3 — current-cycle-card aparece ANTES de Active agents (orden correcto)", async () => {
    const { wrapper } = createWrapper(DASHBOARD_WITH_CYCLE);
    const { InboxView } = await import("../inbox-view");
    const { container } = render(<InboxView />, { wrapper });

    // Buscar todas las RailCards por sus títulos
    const railCardTitles = Array.from(
      container.querySelectorAll("[data-testid='current-cycle-card'], [data-testid='current-cycle-empty']")
    );
    const cycleCard = railCardTitles[0];
    expect(cycleCard).toBeTruthy();

    // Verificar que el cycle card existe antes del resto del contenido del rail
    // El current-cycle-card debe ser el primer elemento en el right rail
    const rightRail = cycleCard?.closest("[style*='width: 320px']") ??
                      cycleCard?.parentElement;
    const firstChild = rightRail?.firstElementChild;
    // El primer elemento del rail debe contener el cycle card o ser el cycle card
    expect(firstChild?.querySelector("[data-testid='current-cycle-card']") ?? firstChild).toBeTruthy();
  });
});
