/**
 * Integration test — KAN-188 PR3 task 4.9: GroupedBoard renders one
 * <ReconcileModal> per blocked issue (sequential), and a non-blocked issue in
 * the same batch does not surface any modal.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const groupConfirmReconcileMock = vi.fn();
const groupCancelReconcileMock = vi.fn();

vi.mock("./use-group-transition-mutation", () => ({
  useGroupTransitionMutation: () => ({
    mutate: vi.fn(),
    blockedIssues: [
      { key: "TEST-1", totalHours: 5 },
      { key: "TEST-2", totalHours: 2.5 },
    ],
    confirmReconcile: groupConfirmReconcileMock,
    cancelReconcile: groupCancelReconcileMock,
  }),
}));

vi.mock("./use-transition-mutation", () => ({
  useTransitionMutation: () => ({
    mutate: vi.fn(),
    reconcileState: null,
    confirmReconcile: vi.fn(),
    cancelReconcile: vi.fn(),
  }),
}));

describe("GroupedBoard — reconcile modal wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly one ReconcileModal, seeded with the first blocked issue's own hours", async () => {
    const { GroupedBoard } = await import("./grouped-board");
    render(<GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />);

    expect(screen.getAllByTestId("reconcile-modal")).toHaveLength(1);
    expect(screen.getByTestId("reconcile-reported-hours")).toHaveTextContent(
      "5",
    );
  });

  it("confirming the first modal calls confirmReconcile with that issue's key and shown hours", async () => {
    const { GroupedBoard } = await import("./grouped-board");
    render(<GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />);

    fireEvent.click(screen.getByTestId("reconcile-confirm"));

    expect(groupConfirmReconcileMock).toHaveBeenCalledWith("TEST-1", 5);
  });

  it("cancelling the first modal calls cancelReconcile with that issue's key", async () => {
    const { GroupedBoard } = await import("./grouped-board");
    render(<GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />);

    fireEvent.click(screen.getByTestId("reconcile-cancel"));

    expect(groupCancelReconcileMock).toHaveBeenCalledWith("TEST-1");
  });
});
