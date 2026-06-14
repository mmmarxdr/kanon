/**
 * KAN-98 / PR4 — PPM Schedule Slot real render.
 *
 * Displays IssueSchedule fields from the read-side GET /api/issues/:key/schedule
 * endpoint wired in useIssueSchedule. Fields are read-only in W1 — editing UI
 * is a later cycle (KAN-105 Gantt).
 *
 * Decimal convention: estimateHours arrives as string | null from the API.
 * Number(estimateHours) is called only at this display edge.
 *
 * data-testid="schedule-slot" is preserved so existing tests do not break.
 *
 * Null/empty states:
 *  - isLoading: true or data === undefined → show nothing (avoids flash)
 *  - data: null, !isLoading               → "No schedule yet" empty state
 *  - data: IssueSchedule                  → render fields; null fields are omitted
 */

import { useIssueSchedule } from "./use-issue-schedule";
import type { IssueSchedule } from "./use-issue-schedule";

export interface IssueScheduleSlotProps {
  issueKey: string;
}

/** Format an ISO datetime string to a locale date (e.g. "Jul 31, 2026"). */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ScheduleFields({ schedule }: { schedule: IssueSchedule }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Section label */}
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        Schedule
      </div>

      {/* Estimate hours — only shown when present */}
      {schedule.estimateHours !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 52 }}>
            Estimate
          </span>
          <span style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 500 }}>
            {Number(schedule.estimateHours)}h
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Progress</span>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>
            {schedule.progress}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "var(--line-2, #e0e0e0)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${schedule.progress}%`,
              borderRadius: 2,
              background: "var(--accent, #5b6af0)",
              transition: "width 0.2s ease",
            }}
          />
        </div>
      </div>

      {/* Start date — only shown when present */}
      {schedule.startDate !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 52 }}>Start</span>
          <span style={{ fontSize: 12, color: "var(--ink-1)" }}>
            {formatDate(schedule.startDate)}
          </span>
        </div>
      )}

      {/* Due date — only shown when present */}
      {schedule.dueDate !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 52 }}>Due</span>
          <span style={{ fontSize: 12, color: "var(--ink-1)" }}>
            {formatDate(schedule.dueDate)}
          </span>
        </div>
      )}
    </div>
  );
}

export function IssueScheduleSlot({ issueKey }: IssueScheduleSlotProps) {
  const { data, isLoading } = useIssueSchedule(issueKey);

  return (
    <div
      data-testid="schedule-slot"
      style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px 18px" }}
    >
      {/* While loading or data not yet resolved, render nothing to avoid flash */}
      {isLoading || data === undefined ? null
      : data === null ? (
        /* Empty state — no schedule row exists for this issue yet */
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
        /* Populated schedule */
        <ScheduleFields schedule={data} />
      )}
    </div>
  );
}
