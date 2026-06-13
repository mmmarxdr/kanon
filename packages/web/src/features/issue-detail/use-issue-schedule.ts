/**
 * KAN-108 slice 6 — PPM Schedule Slot null adapter
 *
 * TODO(KAN-98): wire to real scheduling API once ADR-0005 backend lands.
 *
 * Interface shaped to ADR-0005 D2 (IssueSchedule model) so the KAN-98 swap is
 * a localized change — only this function body gains a useQuery call.
 */

/**
 * IssueSchedule mirrors the ADR-0005 D2 `IssueSchedule` Prisma model fields
 * that are relevant for the Gantt / schedule slot UI:
 *
 * - startDate / dueDate   → Plan plane (human-owned commitment, ADR-0005 D1)
 * - progress              → 0–100, human/agent-reported (stored as Int 0-100 in DB)
 * - estimateHours         → hours distinct from Issue.estimate story-points (ADR-0005 D2)
 * - baselineStart / baselineEnd → immutable snapshot set at cycle activation (ADR-0005 D1)
 */
export interface IssueSchedule {
  startDate: string | null;
  dueDate: string | null;
  /** Progress reported by human/agent, 0–100. Stored as Int in DB; exposed as a
   *  0..1 fraction here for convenience in UI (e.g. progress bars). */
  progress: number | null;
  /** Estimated effort in hours (ADR-0005 D2). Distinct from Issue.estimate story points. */
  estimateHours: number | null;
  baselineStart: string | null;
  baselineEnd: string | null;
}

/**
 * Null adapter — always returns { data: null, isLoading: false }.
 *
 * When KAN-98 lands, replace the body with a real useQuery call.
 * The slot component's null→populated branch already exists.
 */
export function useIssueSchedule(
  _issueKey: string,
): { data: IssueSchedule | null; isLoading: boolean } {
  // TODO(KAN-98): replace with useQuery(scheduleQueryOptions(issueKey))
  return { data: null, isLoading: false };
}
