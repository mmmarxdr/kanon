import type { Issue, PrismaClient } from "@prisma/client";
import { createActivityLog } from "../activity/service.js";

// ---------------------------------------------------------------------------
// Board-column mapping (mirrors packages/web/src/stores/board-store.ts)
// ---------------------------------------------------------------------------

/**
 * Maps every IssueState to the board-column index it belongs to.
 *
 * Column order matches the kanban pipeline:
 *   0 = backlog, 1 = todo, 2 = in_progress, 3 = review, 4 = done
 */
export const STATE_TO_COLUMN_INDEX: Record<string, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

/**
 * Default IssueState for each column index (used when auto-advancing a parent).
 * One state per column now that the pipeline is flat.
 */
export const COLUMN_DEFAULT_STATES: readonly string[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
];

// ---------------------------------------------------------------------------
// Auto-advance logic
// ---------------------------------------------------------------------------

/**
 * After a child issue transitions, check whether the parent should
 * automatically advance to the next board column.
 *
 * Rules:
 * - Only advance forward, never backward.
 * - Advance when the *minimum* column among all children exceeds the parent's
 *   current column.
 * - The parent's new state is the column's default state.
 * - An activity log entry is created noting the transition was automatic.
 */
export async function checkAndAdvanceParent(
  prisma: PrismaClient,
  childIssue: Pick<Issue, "parentId">,
  memberId: string,
): Promise<void> {
  if (!childIssue.parentId) return;

  // Fetch parent and all its children in one query
  const parent = await prisma.issue.findUnique({
    where: { id: childIssue.parentId },
    include: {
      children: { select: { id: true, state: true } },
    },
  });

  if (!parent || parent.children.length === 0) return;

  const parentColumnIndex = STATE_TO_COLUMN_INDEX[parent.state];
  if (parentColumnIndex === undefined) return;

  // Find the minimum column index among all children
  const minChildColumn = Math.min(
    ...parent.children.map((c) => STATE_TO_COLUMN_INDEX[c.state] ?? 0),
  );

  // Only advance forward
  if (minChildColumn <= parentColumnIndex) return;

  const targetState = COLUMN_DEFAULT_STATES[minChildColumn];
  if (!targetState) return;

  // Update parent state
  await prisma.issue.update({
    where: { id: parent.id },
    data: { state: targetState as any },
  });

  // Log automatic transition
  await createActivityLog({
    issueId: parent.id,
    memberId,
    action: "state_changed",
    details: {
      from: parent.state,
      to: targetState,
      automatic: true,
      reason: "All children advanced past current column",
    },
  });
}
