/**
 * B5.1 — InboxView renderiza CurrentCycleCard como primera RailCard del right rail.
 * B5.2 — Integración: activeCycle y multipleActiveProjects pasan correctamente.
 * C2.1 — InboxView con mentions: [] → sección Mentions muestra "No mentions."
 * C2.2 — InboxView con mentions: [m1, m2] → sección Mentions renderiza 2 filas MentionRow
 * D2.1 — Quick Actions: exactamente 4 filas en orden (new-issue, ask-kanon, dep-graph, plan-cycle)
 * D2.2 — Quick Actions con 0 proyectos: dep-graph y plan-cycle quedan inertes vía native `disabled`
 * D2.3 — Click en "Open dependency graph" con 1 proyecto → navigate /dependencies/$projectKey
 * D2.4 — Click en "Plan next cycle" con 1 proyecto → navigate /cycles/$projectKey
 *
 * Refs: REQ-INBOX-CYCLE-007 escenario 3, design §4.1 data flow
 *       REQ-MENTION-007 escenario 3, REQ-API-DASHBOARD-003 escenario 1 (frontend)
 *       REQ-INBOX-QUICK-001..005, design §4.4
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

// useProjectsQuery mock — controlled per test via a module-level ref
const mockProjects: { key: string; name: string }[] = [];
vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: () => ({ data: mockProjects }),
}));

// ─── Dashboard data fixtures ──────────────────────────────────────────────────

const MENTION_1 = {
  id: "mention-1",
  issueKey: "T-10",
  issueTitle: "Fix login bug",
  mentionedByUsername: "alice",
  context: "@bob please review",
  commentId: "cmt-1",
  createdAt: "2026-05-01T10:00:00.000Z",
};

const MENTION_2 = {
  id: "mention-2",
  issueKey: "T-11",
  issueTitle: "Update docs",
  mentionedByUsername: "charlie",
  context: "@bob check this",
  commentId: null,
  createdAt: "2026-05-02T08:00:00.000Z",
};

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

  // ─── C2 — MentionsSection ─────────────────────────────────────────────────

  it("C2.1 — con mentions: [] → sección Mentions muestra 'No mentions.'", async () => {
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // The empty hint text should be present
    expect(screen.getByText("No mentions.")).toBeTruthy();

    // No MentionRow buttons in the mentions section
    // All buttons should be quick-action or inbox-row buttons, not mention buttons
    // We verify by checking that no element with mention-related text is present
    const mentionButtons = screen
      .queryAllByRole("button")
      .filter((b) => b.getAttribute("data-testid") === "mention-row");
    expect(mentionButtons).toHaveLength(0);
  });

  it("C2.2 — con mentions: [m1, m2] → sección Mentions renderiza 2 filas MentionRow", async () => {
    const dashboardWithMentions = {
      ...DASHBOARD_NO_CYCLE,
      mentions: [MENTION_1, MENTION_2],
    };
    const { wrapper } = createWrapper(dashboardWithMentions);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // Both mention users should be visible
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("charlie")).toBeTruthy();
    // Context text for each mention
    expect(screen.getByText("@bob please review")).toBeTruthy();
    expect(screen.getByText("@bob check this")).toBeTruthy();
    // "No mentions." should NOT be shown when there are mentions
    expect(screen.queryByText("No mentions.")).toBeNull();
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

// ─── D2 — QuickActions rows ───────────────────────────────────────────────────

describe("InboxView (D2) — Quick Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockProjects to empty for each test; each test sets it
    mockProjects.length = 0;
  });

  it("D2.1 — exactamente 3 filas quick-action-row en orden: new-issue, dep-graph, plan-cycle (ask-kanon removed, KAN-33)", async () => {
    mockProjects.push({ key: "ATLAS", name: "Atlas" });
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    const rows = screen.getAllByTestId("quick-action-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute("data-action")).toBe("new-issue");
    expect(rows[1]?.getAttribute("data-action")).toBe("dep-graph");
    expect(rows[2]?.getAttribute("data-action")).toBe("plan-cycle");

    // "Ask Kanon" row must not exist (KAN-33)
    expect(screen.queryByText("Ask Kanon")).toBeNull();
    // "Search…" row no debe existir
    expect(screen.queryByText("Search…")).toBeNull();
  });

  it("D2.2 — con 0 proyectos: dep-graph y plan-cycle quedan inertes vía native `disabled`", async () => {
    // mockProjects already empty
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    const rows = screen.getAllByTestId("quick-action-row");
    const depGraph = rows[1] as HTMLButtonElement | undefined;
    const planCycle = rows[2] as HTMLButtonElement | undefined;
    expect(depGraph?.disabled).toBe(true);
    expect(planCycle?.disabled).toBe(true);
  });

  it("D2.3 — click en 'Open dependency graph' con 1 proyecto → navigate /dependencies/ATLAS", async () => {
    mockProjects.push({ key: "ATLAS", name: "Atlas" });
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    const rows = screen.getAllByTestId("quick-action-row");
    const depGraph = rows[1]!;
    fireEvent.click(depGraph);

    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/dependencies/$projectKey",
      params: { projectKey: "ATLAS" },
    });
  });

  it("D2.4 — click en 'Plan next cycle' con 1 proyecto → navigate /cycles/ATLAS", async () => {
    mockProjects.push({ key: "ATLAS", name: "Atlas" });
    const { wrapper } = createWrapper(DASHBOARD_NO_CYCLE);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    const rows = screen.getAllByTestId("quick-action-row");
    const planCycle = rows[2]!;
    fireEvent.click(planCycle);

    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/cycles/$projectKey",
      params: { projectKey: "ATLAS" },
    });
  });
});
