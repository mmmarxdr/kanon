import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GroupDrillDown } from "@/features/board/group-drill-down";
import type { Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

// Mock the hook to control loading / data states
const mockUseGroupIssuesQuery = vi.fn();
vi.mock("@/features/board/use-issues-query", () => ({
  useGroupIssuesQuery: (...args: unknown[]) => mockUseGroupIssuesQuery(...args),
}));

// Mock IssueCard to avoid needing dnd-kit context
vi.mock("@/features/board/issue-card", () => ({
  IssueCard: ({ issue }: { issue: Issue }) => (
    <div data-testid={`issue-card-${issue.key}`}>{issue.title}</div>
  ),
}));

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

function renderDrillDown(
  groupKey: string,
  onClose = vi.fn(),
  onSelectIssue = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <GroupDrillDown
        projectKey="TEST"
        groupKey={groupKey}
        onClose={onClose}
        onSelectIssue={onSelectIssue}
      />
    </QueryClientProvider>,
  );
}

describe("GroupDrillDown", () => {
  beforeEach(() => {
    mockUseGroupIssuesQuery.mockReset();
  });

  it("renders the humanized title from groupKey", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    expect(screen.getByText("Auth Model")).toBeInTheDocument();
  });

  it("renders the raw groupKey", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    expect(screen.getByText("sdd/auth-model")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    expect(screen.getByText("Loading issues...")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    });

    renderDrillDown("sdd/auth-model");
    expect(
      screen.getByText("Failed to load issues: Network error"),
    ).toBeInTheDocument();
  });

  it("shows empty state", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    expect(screen.getByText("No issues in this group.")).toBeInTheDocument();
  });

  it("renders child issues", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply", title: "First" }),
      makeIssue({ key: "KAN-2", state: "verify", title: "Second" }),
    ];
    mockUseGroupIssuesQuery.mockReturnValue({
      data: issues,
      isLoading: false,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    expect(screen.getByText("2 issues")).toBeInTheDocument();
    expect(screen.getByTestId("issue-card-KAN-1")).toBeInTheDocument();
    expect(screen.getByTestId("issue-card-KAN-2")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    const onClose = vi.fn();

    renderDrillDown("sdd/auth-model", onClose);
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    const onClose = vi.fn();

    renderDrillDown("sdd/auth-model", onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    const onClose = vi.fn();

    renderDrillDown("sdd/auth-model", onClose);
    // Backdrop has aria-hidden="true" — find it and click
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it("has correct aria attributes", () => {
    mockUseGroupIssuesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    renderDrillDown("sdd/auth-model");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Group: Auth Model");
  });
});
