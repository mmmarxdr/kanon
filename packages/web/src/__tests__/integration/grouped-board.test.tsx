import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupedBoard } from "@/features/board/grouped-board";
import { useBoardStore } from "@/stores/board-store";
import type { BoardColumn } from "@/stores/board-store";
import type { GroupSummary, Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

// Mock mutation hooks
vi.mock("@/features/board/use-group-transition-mutation", () => ({
  useGroupTransitionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

// Mock useGroupIssuesQuery (used by GroupDrillDown)
vi.mock("@/features/board/use-issues-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/board/use-issues-query")>();
  return {
    ...actual,
    useGroupIssuesQuery: () => ({
      data: [],
      isLoading: false,
      error: null,
    }),
  };
});

function makeGroup(
  overrides: Partial<GroupSummary> & { groupKey: string; latestState: IssueState },
): GroupSummary {
  return {
    count: 2,
    title: "Test Group",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIssue(
  overrides: Partial<Issue> & { key: string; state: IssueState },
): Issue {
  return {
    id: `id-${overrides.key}`,
    title: `Issue ${overrides.key}`,
    type: "task",
    priority: "medium",
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderGroupedBoard(groups: GroupSummary[], issues: Issue[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <GroupedBoard
        groups={groups}
        issues={issues}
        projectKey="TEST"
      />
    </QueryClientProvider>,
  );
}

describe("GroupedBoard", () => {
  beforeEach(() => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: {},
      viewMode: "grouped",
      showUngrouped: false,
    });
  });

  it("renders the grouped-board container", () => {
    renderGroupedBoard([]);
    expect(screen.getByTestId("grouped-board")).toBeInTheDocument();
  });

  it("renders visible columns with correct headers", () => {
    renderGroupedBoard([]);

    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Testing")).toBeInTheDocument();
  });

  it("renders group cards in the correct columns", () => {
    const groups: GroupSummary[] = [
      makeGroup({
        groupKey: "sdd/auth",
        latestState: "apply",
        title: "Auth Feature",
        count: 3,
      }),
      makeGroup({
        groupKey: "sdd/ui",
        latestState: "verify",
        title: "UI Feature",
        count: 2,
      }),
    ];

    renderGroupedBoard(groups);

    // Auth group is in "apply" state -> in_progress column
    expect(screen.getByTestId("group-card-sdd/auth")).toBeInTheDocument();
    expect(screen.getByText("Auth Feature")).toBeInTheDocument();

    // UI group is in "verify" state -> testing column
    expect(screen.getByTestId("group-card-sdd/ui")).toBeInTheDocument();
    expect(screen.getByText("UI Feature")).toBeInTheDocument();
  });

  it("hides ungrouped issues by default", () => {
    const groups: GroupSummary[] = [
      makeGroup({ groupKey: "sdd/auth", latestState: "apply", title: "Auth" }),
    ];
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", title: "Ungrouped Issue" }),
    ];

    renderGroupedBoard(groups, issues);

    // Ungrouped issue should not appear
    expect(screen.queryByText("Ungrouped Issue")).not.toBeInTheDocument();
  });

  it("shows ungrouped issues when showUngrouped is true", () => {
    useBoardStore.setState({ showUngrouped: true });

    const groups: GroupSummary[] = [
      makeGroup({ groupKey: "sdd/auth", latestState: "apply", title: "Auth" }),
    ];
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", title: "Ungrouped Issue" }),
    ];

    renderGroupedBoard(groups, issues);

    // Now ungrouped issue should appear
    expect(screen.getByText("Ungrouped Issue")).toBeInTheDocument();
  });

  it("respects hidden columns", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>([
        "backlog",
        "finished",
        "testing",
      ]),
    });

    renderGroupedBoard([]);

    expect(screen.queryByText("Testing")).not.toBeInTheDocument();
    expect(screen.getByText("Analysis")).toBeInTheDocument();
  });
});
