/**
 * Integration test — KAN-188 PR3 task 4.9: KanbanBoard renders <ReconcileModal>
 * when useTransitionMutation surfaces reconcileState, and the transition only
 * completes after the user confirms (not on a single drag-drop click).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Issue } from "@/types/issue";

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const confirmReconcileMock = vi.fn();
const cancelReconcileMock = vi.fn();

vi.mock("./use-transition-mutation", () => ({
  useTransitionMutation: () => ({
    mutate: vi.fn(),
    reconcileState: { issueKey: "TEST-1", totalHours: 5 },
    confirmReconcile: confirmReconcileMock,
    cancelReconcile: cancelReconcileMock,
  }),
}));

function makeIssue(key: string, state: Issue["state"] = "review"): Issue {
  return {
    id: `id-${key}`,
    key,
    title: `Issue ${key}`,
    type: "task",
    priority: "medium",
    state,
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
}

describe("KanbanBoard — reconcile modal wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders ReconcileModal when the transition mutation surfaces reconcileState", async () => {
    const { KanbanBoard } = await import("./kanban-board");
    render(
      <KanbanBoard issues={[makeIssue("TEST-1")]} projectKey="proj-1" />,
    );

    const modal = screen.getByTestId("reconcile-modal");
    expect(modal).toBeInTheDocument();
    expect(screen.getByTestId("reconcile-reported-hours")).toHaveTextContent(
      "5",
    );
  });

  it("confirming the modal calls confirmReconcile with the shown hours", async () => {
    const { KanbanBoard } = await import("./kanban-board");
    render(
      <KanbanBoard issues={[makeIssue("TEST-1")]} projectKey="proj-1" />,
    );

    fireEvent.click(screen.getByTestId("reconcile-confirm"));

    expect(confirmReconcileMock).toHaveBeenCalledWith(5);
  });

  it("cancelling the modal calls cancelReconcile and does not confirm", async () => {
    const { KanbanBoard } = await import("./kanban-board");
    render(
      <KanbanBoard issues={[makeIssue("TEST-1")]} projectKey="proj-1" />,
    );

    fireEvent.click(screen.getByTestId("reconcile-cancel"));

    expect(cancelReconcileMock).toHaveBeenCalledOnce();
    expect(confirmReconcileMock).not.toHaveBeenCalled();
  });
});
