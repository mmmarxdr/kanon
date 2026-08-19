/**
 * KAN-108 — IssuePage layout: all sections render simultaneously (no tab gating).
 *
 * Single-scroll workspace: all five semantic sections are mounted together.
 *
 * T1 — Activity remains in the workspace document
 * T2 — General, relationships and resources remain simultaneously available
 * T3 — section navigation is location navigation, not tabs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api-client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const navigateSpy = vi.fn();
const issueQueryState = vi.hoisted(() => ({
  value: {
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
    } as Record<string, unknown> | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));
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
  useIssueDetailQuery: () => issueQueryState.value,
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
    isError: false,
    error: null,
  }),
}));

vi.mock("@/features/issue-detail/use-unified-timeline", () => ({
  useUnifiedTimeline: () => ({ items: [], isLoading: false, isError: false }),
  selectCommentTimelineItems: (items: unknown[]) => items,
}));

vi.mock("@/features/issue-detail/use-issue-mutations", () => ({
  useUpdateIssueMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useAddCommentMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null }),
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

describe("IssuePage — single-scroll workspace (KAN-108)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueQueryState.value = {
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
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  });

  it("T1 — keeps Activity and its composer inside the one workspace document", async () => {
    await renderIssuePage();
    expect(document.querySelector('[data-current-issue-key="KAN-1"]')).toBeInTheDocument();
    const workspace = screen.getByTestId("issue-detail-scroll");
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(workspace).toContainElement(screen.getByRole("heading", { name: "Activity" }));
    expect(activity).toBe(workspace.querySelector("#issue-section-activity"));
    expect(within(activity).getByTestId("unified-timeline")).toBeInTheDocument();
    expect(within(activity).getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("T2 — keeps General, relationships, resources, and metadata mounted in the workspace", async () => {
    await renderIssuePage();
    const workspace = screen.getByTestId("issue-detail-scroll");
    expect(workspace).toContainElement(screen.getByTestId("description-section"));
    expect(workspace).toContainElement(screen.getByTestId("document-list"));
    expect(workspace).toContainElement(screen.getByTestId("children-section"));
    expect(workspace).toContainElement(screen.getByTestId("dependencies-section"));
    expect(workspace).toContainElement(screen.getByTestId("metadata-section"));
    expect(workspace).toContainElement(screen.getByTestId("synced-from-tools"));
    expect(workspace).toContainElement(screen.getByTestId("schedule-slot"));
  });

  it("T3 — exposes section-location navigation rather than a tab strip", async () => {
    await renderIssuePage();
    expect(screen.getByRole("navigation", { name: "Issue sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Timeline$/ })).not.toBeInTheDocument();
  });

  it("T4 — maps the API client's typed 404 to the safe five-landmark not-found state", async () => {
    issueQueryState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, "NOT_FOUND", "Issue not found"),
      refetch: vi.fn(),
    };

    await renderIssuePage();

    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.getAllByText("This issue could not be found.")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("IssuePage stale-query safety", () => {
  it.each([
    [new ApiError(404, "NOT_FOUND", "Issue not found"), "This issue could not be found."],
    [new ApiError(500, "INTERNAL_SERVER_ERROR", "Issue failed"), "Unable to load this issue."],
  ])("keeps retained editable issue content visible for %s", async (error, message) => {
    issueQueryState.value = {
      data: {
        id: "i-1", key: "KAN-1", title: "Stale issue", type: "task", priority: "medium", state: "todo", description: "stale", project: { id: "p-1", key: "KAN", name: "Kanon" }, children: [], blocks: [], blockedBy: [], subscribed: false, activeWorkers: [],
      },
      isLoading: false,
      isError: true,
      error,
      refetch: vi.fn(),
    };

    await renderIssuePage();

    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-detail-header")).toBeInTheDocument();
    expect(screen.getByTestId("description-section")).toHaveTextContent("stale");
    expect(screen.getAllByTestId("unified-timeline")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
