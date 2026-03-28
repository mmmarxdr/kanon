import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { IssueDetailPanel } from "@/features/issue-detail/issue-detail-panel";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { TabsSection } from "@/features/issue-detail/tabs-section";
import { IssueCard } from "@/features/board/issue-card";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { IssueDetail, Comment, ActivityLog, Issue } from "@/types/issue";

/**
 * Integration tests for the Issue Detail Panel feature.
 *
 * Since the IssueDetailPanel shell (Phase 4) may still be in progress,
 * these tests compose the individual components together to verify
 * the complete user flows described in the spec scenarios.
 */

/* ------------------------------------------------------------------ */
/*  Shared fixtures & helpers                                          */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

const ISSUE_KEY = "KAN-42";
const PROJECT_KEY = "KAN";

const MOCK_DETAIL: IssueDetail = {
  id: "issue-1",
  key: ISSUE_KEY,
  title: "Implement feature",
  description: "# Description\n\nSome **markdown** content with a [link](http://example.com).",
  type: "task",
  priority: "medium",
  state: "apply",
  labels: ["frontend", "urgent"],
  assigneeId: "user-1",
  assignee: { id: "user-1", username: "alice", email: "alice@test.com" },
  projectId: "proj-1",
  project: { id: "proj-1", key: PROJECT_KEY, name: "Kanon" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
};

const MOCK_LIST_ISSUES: Issue[] = [
  {
    id: "issue-1",
    key: ISSUE_KEY,
    title: "Implement feature",
    type: "task",
    priority: "medium",
    state: "apply",
    labels: ["frontend"],
    assigneeId: "user-1",
    assignee: { username: "alice" },
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  },
];

const MOCK_COMMENTS: Comment[] = [
  {
    id: "c-1",
    body: "First comment with **bold** text",
    source: "human",
    author: { id: "user-1", username: "alice" },
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

const MOCK_ACTIVITIES: ActivityLog[] = [
  {
    id: "a-1",
    action: "created",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "a-2",
    action: "state_changed",
    field: "state",
    oldValue: "explore",
    newValue: "apply",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-10T00:00:00Z",
  },
];

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return queryClient;
}

/**
 * Renders a simulated panel with all issue detail components composed together,
 * mimicking what IssueDetailPanel will do once Phase 4 is complete.
 */
function renderPanelSimulation({
  queryClient,
  onClose,
  onTitleChange,
  onFieldChange,
  onTransition,
  onAddComment,
}: {
  queryClient: QueryClient;
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onFieldChange: (payload: Record<string, unknown>) => void;
  onTransition: (toState: string) => void;
  onAddComment: (body: string) => void;
}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-detail-title"
      data-testid="issue-detail-panel"
    >
      {/* Backdrop */}
      <div data-testid="backdrop" onClick={onClose} />

      {/* Panel content */}
      <div>
        <IssueDetailHeader
          issueKey={MOCK_DETAIL.key}
          title={MOCK_DETAIL.title}
          onTitleChange={onTitleChange}
          onClose={onClose}
        />

        <MetadataSection
          issue={MOCK_DETAIL}
          projectKey={PROJECT_KEY}
          onFieldChange={onFieldChange}
          onTransition={onTransition}
        />

        <TabsSection
          comments={MOCK_COMMENTS}
          commentsLoading={false}
          activities={MOCK_ACTIVITIES}
          activitiesLoading={false}
          onAddComment={onAddComment}
          isSubmittingComment={false}
        />
      </div>
    </div>,
    { wrapper },
  );
}

/* ------------------------------------------------------------------ */
/*  Integration tests                                                  */
/* ------------------------------------------------------------------ */

describe("Issue Detail Panel — Integration", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("displays all issue data when panel opens (R-IDP-03, R-IDP-04)", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Panel renders as dialog
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "issue-detail-title");

    // Issue key badge
    expect(screen.getByText(ISSUE_KEY)).toBeInTheDocument();

    // Title
    expect(screen.getByText("Implement feature")).toBeInTheDocument();

    // Metadata fields
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Labels")).toBeInTheDocument();

    // Label values
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();

    // Comments tab (default active) — "alice" appears in both comments and assignee dropdown
    expect(screen.getAllByText("alice").length).toBeGreaterThanOrEqual(1);
  });

  it("inline title editing: click, type, blur saves (R-IDP-05)", async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange,
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Click title to enter edit mode
    await user.click(screen.getByText("Implement feature"));

    // Type new title
    const input = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(input);
    await user.type(input, "Updated feature title");

    // Blur to save
    fireEvent.blur(input);

    expect(onTitleChange).toHaveBeenCalledWith("Updated feature title");
  });

  it("metadata dropdown change triggers mutation callback (R-IDP-06)", async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange,
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Change priority dropdown
    const selects = screen.getAllByRole("combobox");
    const prioritySelect = selects[1]!;
    await user.selectOptions(prioritySelect, "critical");

    expect(onFieldChange).toHaveBeenCalledWith({ priority: "critical" });
  });

  it("comments display with markdown rendering (R-IDP-08)", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Comment author (also appears in assignee dropdown) and markdown content
    expect(screen.getAllByText("alice").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("add comment via form (R-IDP-09)", async () => {
    const user = userEvent.setup();
    const onAddComment = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment,
    });

    // Type in comment textarea
    const textarea = screen.getByRole("textbox", { name: /new comment/i });
    await user.type(textarea, "Integration test comment");

    // Submit
    await user.click(screen.getByRole("button", { name: /comment/i }));

    expect(onAddComment).toHaveBeenCalledWith("Integration test comment");
  });

  it("activity timeline displays from-to state changes (R-IDP-10)", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Switch to Activity tab
    const activityTab = screen.getByRole("tab", { name: /activity/i });
    await user.click(activityTab);

    // Should show state change from-to
    expect(screen.getByText("explore")).toBeInTheDocument();
    expect(screen.getByText("apply")).toBeInTheDocument();
    expect(screen.getByText("changed state")).toBeInTheDocument();
    expect(screen.getByText("created this issue")).toBeInTheDocument();
  });

  it("close via backdrop click (R-IDP-11)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose,
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Click backdrop
    await user.click(screen.getByTestId("backdrop"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("panel has correct ARIA attributes for accessibility (R-IDP-11)", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "issue-detail-title");
  });

  it("state transition uses onTransition callback (R-IDP-06)", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition,
      onAddComment: vi.fn(),
    });

    // Change state dropdown
    const selects = screen.getAllByRole("combobox");
    const stateSelect = selects[2]!;
    await user.selectOptions(stateSelect, "verify");

    expect(onTransition).toHaveBeenCalledWith("verify");
  });

  it("tab switching between Comments and Activity (R-IDP-08, R-IDP-10)", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange: vi.fn(),
      onTransition: vi.fn(),
      onAddComment: vi.fn(),
    });

    // Initially on Comments tab
    expect(
      screen.getByRole("tab", { name: /comments/i }),
    ).toHaveAttribute("aria-selected", "true");
    // Comment content visible (alice appears in both comments and assignee dropdown)
    expect(screen.getByRole("textbox", { name: /new comment/i })).toBeInTheDocument();

    // Switch to Activity
    await user.click(screen.getByRole("tab", { name: /activity/i }));
    expect(
      screen.getByRole("tab", { name: /activity/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("created this issue")).toBeInTheDocument();

    // Switch back to Comments
    await user.click(screen.getByRole("tab", { name: /comments/i }));
    expect(
      screen.getByRole("tab", { name: /comments/i }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

/* ------------------------------------------------------------------ */
/*  Behavioral tests for spec scenarios (R-IDP-01/02/03/06/11)        */
/* ------------------------------------------------------------------ */

// Mock dnd-kit for IssueCard (needs useSortable)
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button", tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

// Mock the query hooks used by IssueDetailPanel
vi.mock("@/features/issue-detail/use-issue-detail-queries", () => ({
  useIssueDetailQuery: (key: string) => ({
    data: {
      id: "issue-1",
      key,
      title: "Implement feature",
      description: "Some description",
      type: "task",
      priority: "medium",
      state: "apply",
      labels: ["frontend"],
      assigneeId: "user-1",
      assignee: { id: "user-1", username: "alice", email: "alice@test.com" },
      projectId: "proj-1",
      project: { id: "proj-1", key: "KAN", name: "Kanon" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    },
    isLoading: false,
  }),
  useCommentsQuery: () => ({ data: [], isLoading: false }),
  useActivityQuery: () => ({ data: [], isLoading: false }),
  useIssueContextQuery: () => ({ data: { sessions: [], sessionCount: 0 }, isLoading: false }),
}));

vi.mock("@/features/issue-detail/use-issue-mutations", () => ({
  useUpdateIssueMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useAddCommentMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/board/use-transition-mutation", () => ({
  useTransitionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Mock focus-trap-react to avoid jsdom focus-trap issues
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/**
 * Helper: renders a minimal board scenario with an IssueCard and optional panel.
 * The `onSelectIssue` callback simulates the board route wiring.
 */
function renderCardWithPanel({
  queryClient,
  showPanel,
  onClose,
  triggerElement,
}: {
  queryClient: QueryClient;
  showPanel: boolean;
  onClose: () => void;
  triggerElement?: HTMLElement | null;
}) {
  const issue: Issue = {
    id: "issue-1",
    key: ISSUE_KEY,
    title: "Implement feature",
    type: "task",
    priority: "medium",
    state: "apply",
    labels: ["frontend"],
    assigneeId: "user-1",
    assignee: { username: "alice" },
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(
    <div>
      <IssueCard issue={issue} onSelect={vi.fn()} />
      {showPanel && (
        <IssueDetailPanel
          issueKey={ISSUE_KEY}
          projectKey={PROJECT_KEY}
          onClose={onClose}
          triggerElement={triggerElement}
        />
      )}
    </div>,
    { wrapper },
  );
}

describe("Issue Detail Panel — Behavioral Spec Scenarios", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("R-IDP-01: Clicking a card calls onSelect with key and element", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const queryClient = createQueryClient();

    const issue: Issue = {
      id: "issue-1",
      key: ISSUE_KEY,
      title: "Implement feature",
      type: "task",
      priority: "medium",
      state: "apply",
      labels: ["frontend"],
      assigneeId: "user-1",
      assignee: { username: "alice" },
      projectId: "proj-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    };

    render(
      <QueryClientProvider client={queryClient}>
        <IssueCard issue={issue} onSelect={onSelect} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByText("Implement feature"));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(ISSUE_KEY, expect.any(HTMLElement));
  });

  it("R-IDP-01: Card click opens panel (card onClick -> panel renders)", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    // Simulate the board route wiring: clicking card sets state, panel renders
    let selectedKey: string | undefined;
    function TestHarness() {
      const [issueKey, setIssueKey] = useState<string | undefined>(undefined);
      selectedKey = issueKey;

      const issue: Issue = MOCK_LIST_ISSUES[0]!;

      return (
        <QueryClientProvider client={queryClient}>
          <IssueCard
            issue={issue}
            onSelect={(key) => setIssueKey(key)}
          />
          {issueKey && (
            <IssueDetailPanel
              issueKey={issueKey}
              projectKey={PROJECT_KEY}
              onClose={() => setIssueKey(undefined)}
            />
          )}
        </QueryClientProvider>
      );
    }

    render(<TestHarness />);

    // Panel should not be visible initially
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Click the card
    await user.click(screen.getByText("Implement feature"));

    // Panel should now be visible
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("R-IDP-02: Panel opens when issue key is provided (URL deep link simulation)", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    // Simulate: URL has ?issue=KAN-42, so panel renders immediately
    render(
      <QueryClientProvider client={queryClient}>
        <IssueDetailPanel
          issueKey={ISSUE_KEY}
          projectKey={PROJECT_KEY}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // Panel should render with the issue data
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(ISSUE_KEY)).toBeInTheDocument();
    expect(screen.getByText("Implement feature")).toBeInTheDocument();
  });

  it("R-IDP-03: Panel closes via Escape key", () => {
    const onClose = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    render(
      <QueryClientProvider client={queryClient}>
        <IssueDetailPanel
          issueKey={ISSUE_KEY}
          projectKey={PROJECT_KEY}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("R-IDP-03: Panel closes via backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    render(
      <QueryClientProvider client={queryClient}>
        <IssueDetailPanel
          issueKey={ISSUE_KEY}
          projectKey={PROJECT_KEY}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    // The backdrop overlay is the outermost fixed div that handles click
    // In IssueDetailPanel, clicking the outer container (not the panel) triggers close
    const backdrop = screen.getByRole("dialog").closest(".fixed");
    expect(backdrop).toBeTruthy();

    // Click the backdrop element directly (simulating click on the outer overlay)
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("R-IDP-11: Focus returns to trigger card on panel close", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    // Create a trigger element to simulate the card
    const triggerEl = document.createElement("div");
    triggerEl.tabIndex = 0;
    triggerEl.textContent = "Trigger Card";
    document.body.appendChild(triggerEl);

    let closed = false;
    const onClose = vi.fn(() => {
      closed = true;
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <IssueDetailPanel
          issueKey={ISSUE_KEY}
          projectKey={PROJECT_KEY}
          onClose={onClose}
          triggerElement={triggerEl}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape to close
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();

    // Simulate the parent unmounting the panel (as board.tsx would do)
    unmount();

    // Wait for requestAnimationFrame to fire
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(triggerEl);

    // Cleanup
    document.body.removeChild(triggerEl);
  });

  it("R-IDP-02: Panel close removes issue key (simulates browser back)", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    // Simulate: panel is open, then onClose is called (which in board.tsx removes ?issue param)
    let issueKey: string | undefined = ISSUE_KEY;
    const onClose = vi.fn(() => {
      issueKey = undefined;
    });

    function TestHarness() {
      const [key, setKey] = useState<string | undefined>(ISSUE_KEY);

      return (
        <QueryClientProvider client={queryClient}>
          {key && (
            <IssueDetailPanel
              issueKey={key}
              projectKey={PROJECT_KEY}
              onClose={() => setKey(undefined)}
            />
          )}
          {!key && <div data-testid="panel-closed">Panel is closed</div>}
        </QueryClientProvider>
      );
    }

    render(<TestHarness />);

    // Panel should be open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-closed")).not.toBeInTheDocument();

    // Press Escape to close (simulates browser back removing URL param)
    fireEvent.keyDown(document, { key: "Escape" });

    // Panel should be gone, closed state should show
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-closed")).toBeInTheDocument();
  });

  it("R-IDP-06: State dropdown calls onTransition (not onFieldChange)", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    const onFieldChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    renderPanelSimulation({
      queryClient,
      onClose: vi.fn(),
      onTitleChange: vi.fn(),
      onFieldChange,
      onTransition,
      onAddComment: vi.fn(),
    });

    // State dropdown is the 3rd combobox (Type, Priority, State)
    const selects = screen.getAllByRole("combobox");
    const stateSelect = selects[2]!;
    await user.selectOptions(stateSelect, "verify");

    // Should call onTransition, NOT onFieldChange
    expect(onTransition).toHaveBeenCalledWith("verify");
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});
