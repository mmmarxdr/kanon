/**
 * KAN-108 slice 6 — PPM Schedule Slot placeholder
 *
 * Renders an empty/coming-soon state while the scheduling backend (KAN-98 /
 * ADR-0005) is not yet implemented. When KAN-98 lands, the useIssueSchedule
 * adapter gains a real query; this component's null→populated branch already
 * exists and just needs the populated state filled in.
 *
 * data-testid="schedule-slot" is preserved from the previous bare div so no
 * existing test references break.
 */

import { useIssueSchedule } from "./use-issue-schedule";

export interface IssueScheduleSlotProps {
  issueKey: string;
}

export function IssueScheduleSlot({ issueKey }: IssueScheduleSlotProps) {
  const { data: schedule } = useIssueSchedule(issueKey);

  return (
    <div
      data-testid="schedule-slot"
      style={{ flex: 1, display: "flex", alignItems: "flex-start", padding: "16px 18px" }}
    >
      {schedule === null ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "inherit",
            letterSpacing: "0.01em",
          }}
        >
          No schedule yet
        </span>
      ) : (
        /* TODO(KAN-98): render schedule fields (startDate, dueDate, progress,
           estimateHours, baselineStart, baselineEnd) once the backend lands. */
        null
      )}
    </div>
  );
}
