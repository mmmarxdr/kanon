import type { PrismaClient, RoadmapStatus, IssueState } from "@prisma/client";

/**
 * Compute the aggregate roadmap status from a set of linked issues.
 *
 * Rules:
 * - No issues → null (status unchanged — caller should skip update)
 * - All issues done → "done"
 * - Any issue not done → "in_progress"
 */
export function computeStatus(
  issues: Pick<{ state: IssueState }, "state">[],
): RoadmapStatus | null {
  if (issues.length === 0) return null;

  const allDone = issues.every((i) => i.state === "done");
  return allDone ? "done" : "in_progress";
}

/**
 * Synchronise a roadmap item's status based on the aggregate state of its
 * linked issues.  Called after every issue transition (single or batch).
 *
 * Mirrors the `checkAndAdvanceParent()` pattern — lightweight, inline, and
 * safe to call even when the issue has no roadmap link (bails early).
 */
export async function syncRoadmapItemStatus(
  prisma: PrismaClient,
  issueId: string,
): Promise<void> {
  // Load the issue to find its roadmapItemId
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { roadmapItemId: true },
  });

  if (!issue?.roadmapItemId) return;

  const roadmapItemId = issue.roadmapItemId;

  // Query all issues linked to the same roadmap item
  const siblingIssues = await prisma.issue.findMany({
    where: { roadmapItemId },
    select: { state: true },
  });

  const newStatus = computeStatus(siblingIssues);
  if (newStatus === null) return;

  // Only update if status actually changed
  const roadmapItem = await prisma.roadmapItem.findUnique({
    where: { id: roadmapItemId },
    select: { status: true },
  });

  if (!roadmapItem || roadmapItem.status === newStatus) return;

  await prisma.roadmapItem.update({
    where: { id: roadmapItemId },
    data: { status: newStatus },
  });
}
