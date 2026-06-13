/**
 * KAN-108 — IssuePage layout: all sections render simultaneously (no tab gating).
 *
 * Direction C zone+dock layout: tab strip and ?tab= search param are gone.
 * Every section is always present in the DOM at the same time:
 *  - IssueTopZone: description, design records, sub-issues, dependencies
 *  - IssueTimelineDock: unified timeline + composer
 *
 * T1 — timeline dock is always present (no ?tab= needed)
 * T2 — all top-zone sections render simultaneously
 * T3 — no tab strip is rendered
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

// issueRoute hooks — no tab field in slice 2
const mockUseParams = vi.fn(() => ({ key: "KAN-1" }));
const mockUseSearch = vi.fn(() => ({ from: undefined as string | undefined }));

vi.mock("../_authenticated/issue", () => ({
  issueRoute: {
    useParams: () => mockUseParams(),
    useSearch: () => mockUseSearch(),
  },
  SubscribeButton: () => null,
}));

// Issue detail queries
vi.mock("@/features/issue-detail/use-issue-detail-queries", () => ({
  useIssueDetailQuery: () => ({
    data: {
      id: "i-1",
      key: "KAN-1",
      title: "Test issue",
      type: "task",
      priority: "medium",
      state: "todo",
      description: "A description",
      project: { id: "p-1", key: "KAN", name: "Kanon" },
      children: [{ id: "c-1", key: "KAN-2", title: "Child", state: "todo", labels: [] }],
      blocks: [],
      blockedBy: [],
      subscribed: false,
      activeWorkers: [],
    },
    isLoading: false,
  }),
  useIssueDocuments: () => ({
    data: [
      {
        id: "doc-1",
        kind: "adr" as const,
        title: "ADR-001",
        body: "# ADR",
        createdAt: new Date().toISOString(),
        author: null,
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/features/issue-detail/use-unified-timeline", () => ({
  useUnifiedTimeline: () => ({ items: [], isLoading: false, isError: false }),
}));

vi.mock("@/features/issue-detail/use-issue-mutations", () => ({
  useUpdateIssueMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useAddCommentMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/board/use-transition-mutation", () => ({
  useTransitionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/cycles/use-cycle-mutations", () => ({
  useAttachIssueMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDetachIssueMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/features/issue-detail/use-subscription-mutations", () => ({
  useSubscribeMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useUnsubscribeMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/issue-detail/issue-detail-header", () => ({
  IssueDetailHeader: () => <div data-testid="issue-detail-header" />,
}));

vi.mock("@/features/issue-detail/metadata-section", () => ({
  MetadataSection: () => <div data-testid="metadata-section" />,
}));

vi.mock("@/features/issue-detail/children-section", () => ({
  ChildrenSection: () => <div data-testid="children-section" />,
}));

vi.mock("@/features/issue-detail/dependencies-section", () => ({
  DependenciesSection: () => <div data-testid="dependencies-section" />,
}));

vi.mock("@/features/issue-detail/document-list", () => ({
  DocumentList: () => <div data-testid="document-list" />,
}));

vi.mock("@/features/issue-detail/unified-timeline", () => ({
  UnifiedTimeline: () => <div data-testid="unified-timeline" />,
}));

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    ChevL: () => null,
    More: () => null,
    Spark: () => null,
    Plus: () => null,
  },
}));

vi.mock("@/components/ui/primitives", () => ({
  Kbd: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/stores/board-store", () => ({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderIssuePage() {
  const { default: IssuePage } = await import(
    "../_authenticated/issue-page"
  );
  const wrapper = createWrapper();
  render(<IssuePage />, { wrapper });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IssuePage — zone+dock layout: all sections always present (KAN-108)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1 — timeline dock is always present in the DOM (no ?tab= needed)", async () => {
    mockUseSearch.mockReturnValue({ from: undefined });
    await renderIssuePage();

    // Timeline dock container is always rendered
    expect(screen.getByTestId("timeline-dock")).toBeInTheDocument();
    // Unified timeline inside the dock
    expect(screen.getByTestId("unified-timeline")).toBeInTheDocument();
    // Composer is inside the dock — check for the Send button
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("T2 — all top-zone sections render simultaneously (no tab gating)", async () => {
    mockUseSearch.mockReturnValue({ from: undefined });
    await renderIssuePage();

    // Top zone container present
    expect(screen.getByTestId("issue-top-zone")).toBeInTheDocument();

    // All sections visible at once — no switching needed
    expect(screen.getByTestId("description-section")).toBeInTheDocument();
    expect(screen.getByTestId("document-list")).toBeInTheDocument();
    expect(screen.getByTestId("children-section")).toBeInTheDocument();
    expect(screen.getByTestId("dependencies-section")).toBeInTheDocument();
  });

  it("T3 — no tab strip is rendered (tabs are gone)", async () => {
    mockUseSearch.mockReturnValue({ from: undefined });
    await renderIssuePage();

    // There should be no tab buttons (Timeline / Sub-issues / Dependencies / Design Records as tabs)
    expect(screen.queryByRole("button", { name: /^Timeline$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sub-issues$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Dependencies$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Design Records$/ })).not.toBeInTheDocument();
  });
});
