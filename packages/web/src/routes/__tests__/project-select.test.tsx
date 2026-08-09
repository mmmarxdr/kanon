/**
 * ProjectSelectPage — component tests (KAN-49 / PR2 tasks 2.5–2.6)
 *
 * Tests:
 *  (a) empty state shows "Create project" action button (not just "Back")
 *  (b) clicking "Create project" opens the create-project modal
 *  (c) projects list renders when data is available (regression guard)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate, mockQueryData, mockQueryLoading, mockWorkspaceRole } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockQueryData: { value: null as unknown[] | null },
  mockQueryLoading: { value: false },
  mockWorkspaceRole: { value: "owner" },
}));

// ─── router mock ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    createRoute: (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => ({ workspaceId: "ws-1" }),
    }),
  };
});

// ─── react-query useQuery mock ────────────────────────────────────────────────

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: mockQueryData.value,
      isLoading: mockQueryLoading.value,
      error: null,
    }),
  };
});

vi.mock("@/hooks/use-workspace-query", () => ({
  useSetActiveWorkspace: () => vi.fn(),
  useWorkspacesQuery: () => ({
    data: [{ id: "ws-1", name: "Workspace", role: mockWorkspaceRole.value }],
  }),
}));

// ─── CreateProjectModal mock ──────────────────────────────────────────────────

vi.mock("@/features/projects/create-project-modal", () => ({
  CreateProjectModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-project-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// ─── import after mocks ───────────────────────────────────────────────────────

// Imported AFTER mocks so createRoute mock is applied
const { ProjectSelectPage } = await import("../_authenticated/project-select");

// ─── helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectSelectPage />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProjectSelectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryData.value = null;
    mockQueryLoading.value = false;
    mockWorkspaceRole.value = "owner";
  });

  // ── (a) empty state shows "Create project" action ─────────────────────────

  it("(a) empty state shows Create project button", async () => {
    mockQueryData.value = [];
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("create-project-btn")).toBeTruthy();
    });
    expect(screen.getByText(/back/i)).toBeTruthy();
  });

  // ── (b) clicking Create project opens modal ────────────────────────────────

  it("(b) clicking Create project opens the create-project modal", async () => {
    mockQueryData.value = [];
    renderPage();
    const btn = await screen.findByTestId("create-project-btn");
    fireEvent.click(btn);
    expect(screen.getByTestId("create-project-modal")).toBeTruthy();
  });

  it("does not offer project creation to non-owners", async () => {
    mockQueryData.value = [];
    mockWorkspaceRole.value = "member";

    renderPage();

    expect(await screen.findByText("No projects in this workspace yet.")).toBeTruthy();
    expect(screen.queryByTestId("create-project-btn")).toBeNull();
  });

  // ── (c) projects list renders (regression guard) ──────────────────────────

  it("(c) renders project list when data is available", async () => {
    mockQueryData.value = [
      { id: "p1", key: "KAN", name: "Kanon", description: null },
    ];
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Kanon")).toBeTruthy();
    });
  });
});
