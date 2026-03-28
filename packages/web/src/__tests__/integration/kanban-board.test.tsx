import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "@/features/board/kanban-board";
import { useBoardStore } from "@/stores/board-store";
import type { BoardColumn, IssueState } from "@/stores/board-store";
import type { Issue } from "@/types/issue";

// Mock the transition mutation hook since it depends on query client internals
vi.mock("@/features/board/use-transition-mutation", () => ({
  useTransitionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

function makeIssue(overrides: Partial<Issue> & { key: string; state: IssueState }): Issue {
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

function renderBoard(issues: Issue[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <KanbanBoard issues={issues} projectKey="TEST" />
    </QueryClientProvider>,
  );
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    // Reset board store to defaults
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: {},
    });
  });

  it("renders visible columns with correct headers", () => {
    renderBoard([]);

    // Default visible columns (backlog and finished are hidden)
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Testing")).toBeInTheDocument();

    // Hidden by default
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
    expect(screen.queryByText("Finished")).not.toBeInTheDocument();
  });

  it("shows backlog column when it is not hidden", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["finished"]),
      filters: {},
    });

    renderBoard([]);

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.queryByText("Finished")).not.toBeInTheDocument();
  });

  it("renders issue cards in the correct columns", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", title: "Implement feature" }),
      makeIssue({ key: "KAN-2", state: "verify", title: "Review code" }),
    ];

    renderBoard(issues);

    expect(screen.getByText("KAN-1")).toBeInTheDocument();
    expect(screen.getByText("Implement feature")).toBeInTheDocument();
    expect(screen.getByText("KAN-2")).toBeInTheDocument();
    expect(screen.getByText("Review code")).toBeInTheDocument();
  });

  it("displays correct issue count in column headers", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply" }),
      makeIssue({ key: "KAN-2", state: "apply" }),
      makeIssue({ key: "KAN-3", state: "apply" }),
    ];

    renderBoard(issues);

    // The Apply column should show count (3) in parentheses
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("filters issues by type", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: { type: "bug" },
    });

    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", type: "bug", title: "Bug issue" }),
      makeIssue({ key: "KAN-2", state: "apply", type: "feature", title: "Feature issue" }),
    ];

    renderBoard(issues);

    expect(screen.getByText("Bug issue")).toBeInTheDocument();
    expect(screen.queryByText("Feature issue")).not.toBeInTheDocument();
  });

  it("filters issues by priority", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: { priority: "critical" },
    });

    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", priority: "critical", title: "Critical bug" }),
      makeIssue({ key: "KAN-2", state: "apply", priority: "low", title: "Low issue" }),
    ];

    renderBoard(issues);

    expect(screen.getByText("Critical bug")).toBeInTheDocument();
    expect(screen.queryByText("Low issue")).not.toBeInTheDocument();
  });

  it("filters issues by text search (key and title)", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: { search: "auth" },
    });

    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "design", title: "Auth middleware" }),
      makeIssue({ key: "KAN-2", state: "design", title: "Database migration" }),
      makeIssue({ key: "AUTH-3", state: "design", title: "Something else" }),
    ];

    renderBoard(issues);

    expect(screen.getByText("Auth middleware")).toBeInTheDocument();
    expect(screen.getByText("Something else")).toBeInTheDocument(); // key matches "AUTH"
    expect(screen.queryByText("Database migration")).not.toBeInTheDocument();
  });

  it("applies combined filters", () => {
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: { type: "bug", priority: "critical" },
    });

    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", type: "bug", priority: "critical", title: "Critical bug" }),
      makeIssue({ key: "KAN-2", state: "apply", type: "bug", priority: "low", title: "Low bug" }),
      makeIssue({ key: "KAN-3", state: "apply", type: "feature", priority: "critical", title: "Critical feature" }),
    ];

    renderBoard(issues);

    expect(screen.getByText("Critical bug")).toBeInTheDocument();
    expect(screen.queryByText("Low bug")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical feature")).not.toBeInTheDocument();
  });

  it("renders card with issue metadata", () => {
    const issues: Issue[] = [
      makeIssue({
        key: "KAN-42",
        state: "apply",
        type: "bug",
        priority: "high",
        title: "Fix login flow",
        labels: ["auth", "urgent"],
        assignee: { username: "alice" },
      }),
    ];

    renderBoard(issues);

    expect(screen.getByText("KAN-42")).toBeInTheDocument();
    expect(screen.getByText("Fix login flow")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument(); // Bug type icon
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });
});
