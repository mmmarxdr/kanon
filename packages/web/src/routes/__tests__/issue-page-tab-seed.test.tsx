/**
 * KAN-33 / KAN-108 — IssuePage seeds the active tab from ?tab= search param.
 *
 * T1 — rendering with ?tab=documents opens the Documents tab (deep-link)
 * T2 — rendering with no tab param defaults to Timeline tab
 * T3 — rendering with ?tab=children opens the Sub-issues tab
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

// issueRoute hooks — we control what useParams/useSearch return per test
type Tab = "timeline" | "children" | "deps" | "documents";
const mockUseParams = vi.fn(() => ({ key: "KAN-1" }));
const mockUseSearch = vi.fn(() => ({ from: undefined as string | undefined, tab: undefined as Tab | undefined }));

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
      description: "",
      project: { id: "p-1", key: "KAN", name: "Kanon" },
      children: [],
      blocks: [],
      blockedBy: [],
      subscribed: false,
      activeWorkers: [],
    },
    isLoading: false,
  }),
  useIssueDocuments: () => ({ data: [], isLoading: false }),
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

describe("IssuePage — tab seeding from URL search param (KAN-33)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1 — ?tab=documents seeds the Documents tab as active", async () => {
    mockUseSearch.mockReturnValue({ from: undefined, tab: "documents" as Tab });
    await renderIssuePage();

    // The Documents tab button should be rendered and active (aria or style marker)
    // We test the tab panel content: document-list is shown
    expect(screen.getByTestId("document-list")).toBeInTheDocument();
    // And timeline is NOT shown
    expect(screen.queryByTestId("unified-timeline")).not.toBeInTheDocument();
  });

  it("T2 — no tab param defaults to Timeline tab", async () => {
    mockUseSearch.mockReturnValue({ from: undefined, tab: undefined });
    await renderIssuePage();

    expect(screen.getByTestId("unified-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("document-list")).not.toBeInTheDocument();
  });

  it("T3 — ?tab=children seeds the Sub-issues tab as active", async () => {
    mockUseSearch.mockReturnValue({ from: undefined, tab: "children" as Tab });
    await renderIssuePage();

    expect(screen.getByTestId("children-section")).toBeInTheDocument();
    expect(screen.queryByTestId("unified-timeline")).not.toBeInTheDocument();
  });
});
