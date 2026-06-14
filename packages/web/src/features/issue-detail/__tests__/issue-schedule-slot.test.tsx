/**
 * IssueScheduleSlot component tests (KAN-108 slice 6 + KAN-98 PR4).
 *
 * Original null-adapter tests (preserved):
 * SS-1: Renders without throwing when the schedule adapter returns null.
 * SS-2: Root element has data-testid="schedule-slot".
 * SS-3: Empty-state label is visible when schedule is null.
 *
 * PR4 real-render tests:
 * SS-4: Renders progress when schedule data is populated.
 * SS-5: Renders estimateHours as a formatted number (display edge conversion).
 * SS-6: Renders startDate and dueDate labels.
 * SS-7: Does not crash when estimateHours is null.
 * SS-8: Does not render "No schedule yet" when schedule is populated.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../use-issue-schedule", () => ({
  useIssueSchedule: vi.fn(),
}));

// Helper to build a mock return value without repeating the cast everywhere
function mockReturn(overrides: {
  data: null | {
    issueId: string;
    startDate: string | null;
    dueDate: string | null;
    progress: number;
    estimateHours: string | null;
    baselineStart: string | null;
    baselineEnd: string | null;
    baselineSetAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  isLoading?: boolean;
}) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isSuccess: true,
    fetchStatus: "idle",
  } as unknown;
}

const SCHEDULE = {
  issueId: "00000000-0000-0000-0000-000000000001",
  startDate: "2026-07-01T00:00:00.000Z",
  dueDate: "2026-07-31T00:00:00.000Z",
  progress: 42,
  estimateHours: "8.00",
  baselineStart: null,
  baselineEnd: null,
  baselineSetAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("IssueScheduleSlot (KAN-108 slice 6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SS-1: renders without throwing when schedule adapter returns null", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(mockReturn({ data: null }));

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    expect(() => {
      render(<IssueScheduleSlot issueKey="KAN-1" />);
    }).not.toThrow();
  });

  it('SS-2: root element has data-testid="schedule-slot"', async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(mockReturn({ data: null }));

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByTestId("schedule-slot")).toBeInTheDocument();
  });

  it("SS-3: empty-state label is visible when schedule is null and not loading", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(mockReturn({ data: null }));

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByText("No schedule yet")).toBeInTheDocument();
  });

  it("SS-4: renders progress when schedule data is populated", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(mockReturn({ data: SCHEDULE }));

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("SS-5: renders estimateHours as a formatted number at display edge", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(
      mockReturn({
        data: { ...SCHEDULE, estimateHours: "3.50", startDate: null, dueDate: null },
      }),
    );

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByText(/3\.5/)).toBeInTheDocument();
  });

  it("SS-6: renders date labels when startDate and dueDate are present", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(
      mockReturn({
        data: { ...SCHEDULE, estimateHours: null },
      }),
    );

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Due")).toBeInTheDocument();
  });

  it("SS-7: does not crash when estimateHours is null", async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(
      mockReturn({
        data: {
          ...SCHEDULE,
          estimateHours: null,
          startDate: null,
          dueDate: null,
        },
      }),
    );

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    expect(() => {
      render(<IssueScheduleSlot issueKey="KAN-1" />);
    }).not.toThrow();
  });

  it('SS-8: does not show "No schedule yet" when schedule is populated', async () => {
    const { useIssueSchedule } = await import("../use-issue-schedule");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useIssueSchedule as any).mockReturnValue(
      mockReturn({
        data: { ...SCHEDULE, estimateHours: "2.00" },
      }),
    );

    const { IssueScheduleSlot } = await import("../issue-schedule-slot");

    render(<IssueScheduleSlot issueKey="KAN-1" />);

    expect(screen.queryByText("No schedule yet")).not.toBeInTheDocument();
  });
});
