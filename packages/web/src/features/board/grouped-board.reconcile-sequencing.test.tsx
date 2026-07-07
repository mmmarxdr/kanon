/**
 * Integration test — KAN-188 PR3 FIX 4: GroupedBoard's blockedIssues[0]-driven
 * sequencing must surface each blocked issue's OWN hours, in order, as the
 * user works through them one at a time.
 *
 * Uses a stateful mock of useGroupTransitionMutation (confirming/cancelling
 * mutates blockedIssues the same way the real hook does) so the sequencing
 * behavior can be exercised directly without hitting the network layer.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { BlockedIssue } from "./use-group-transition-mutation";

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let blockedIssues: BlockedIssue[] | null = [
  { key: "TEST-1", totalHours: 5 },
  { key: "TEST-2", totalHours: 2.5 },
];
const transitionedKeys: string[] = [];

vi.mock("./use-group-transition-mutation", () => ({
  useGroupTransitionMutation: () => ({
    mutate: vi.fn(),
    get blockedIssues() {
      return blockedIssues;
    },
    confirmReconcile: vi.fn((issueKey: string) => {
      transitionedKeys.push(issueKey);
      blockedIssues = (blockedIssues ?? []).filter((b) => b.key !== issueKey);
    }),
    cancelReconcile: vi.fn((issueKey: string) => {
      blockedIssues = (blockedIssues ?? []).filter((b) => b.key !== issueKey);
    }),
    isSubmitting: false,
  }),
}));

vi.mock("./use-transition-mutation", () => ({
  useTransitionMutation: () => ({
    mutate: vi.fn(),
    reconcileState: null,
    confirmReconcile: vi.fn(),
    cancelReconcile: vi.fn(),
    isSubmitting: false,
  }),
}));

describe("GroupedBoard — multi-issue reconcile sequencing", () => {
  afterEach(() => {
    cleanup();
  });

  it("after confirming the first blocked issue, the modal is re-seeded with the second issue's own hours; cancelling it leaves it un-transitioned", async () => {
    const { GroupedBoard } = await import("./grouped-board");
    const { rerender } = render(
      <GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />,
    );

    // First modal: seeded with TEST-1's own hours.
    expect(screen.getByTestId("reconcile-reported-hours")).toHaveTextContent(
      "5",
    );

    fireEvent.click(screen.getByTestId("reconcile-confirm"));
    expect(transitionedKeys).toEqual(["TEST-1"]);

    rerender(<GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />);

    // Second modal: re-seeded with TEST-2's own hours, not TEST-1's stale value.
    expect(screen.getByTestId("reconcile-reported-hours")).toHaveTextContent(
      "2.5",
    );

    fireEvent.click(screen.getByTestId("reconcile-cancel"));
    rerender(<GroupedBoard groups={[]} issues={[]} projectKey="proj-1" />);

    // Cancelling the second issue transitions nothing further, and no modal remains.
    expect(transitionedKeys).toEqual(["TEST-1"]);
    expect(screen.queryByTestId("reconcile-modal")).not.toBeInTheDocument();
  });
});
