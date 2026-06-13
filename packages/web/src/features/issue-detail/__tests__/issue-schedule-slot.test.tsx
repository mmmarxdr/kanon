/**
 * KAN-108 slice 6 — IssueScheduleSlot component tests
 *
 * SS-1: Renders without throwing when the schedule adapter returns null.
 * SS-2: Root element has data-testid="schedule-slot".
 * SS-3: Empty-state label is visible when schedule is null.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("IssueScheduleSlot (KAN-108 slice 6)", () => {
  it("SS-1: renders without throwing when schedule adapter returns null", async () => {
    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    expect(() => {
      render(<IssueScheduleSlot issueKey="KAN-1" />);
    }).not.toThrow();
  });

  it('SS-2: root element has data-testid="schedule-slot"', async () => {
    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByTestId("schedule-slot")).toBeInTheDocument();
  });

  it("SS-3: empty-state label is visible when schedule is null", async () => {
    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    // The component renders a muted "No schedule yet" label in the null/placeholder state
    expect(screen.getByText("No schedule yet")).toBeInTheDocument();
  });
});
