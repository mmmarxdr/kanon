import type { ActivityAction, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/**
 * Create an activity log entry for an issue.
 */
export async function createActivityLog(params: {
  issueId: string;
  memberId: string;
  action: ActivityAction;
  details?: Prisma.InputJsonValue;
}) {
  return prisma.activityLog.create({
    data: {
      issueId: params.issueId,
      memberId: params.memberId,
      action: params.action,
      details: params.details ?? undefined,
    },
  });
}

/**
 * Get activity logs for an issue, ordered by createdAt DESC.
 */
export async function getActivityByIssue(issueId: string) {
  return prisma.activityLog.findMany({
    where: { issueId },
    orderBy: { createdAt: "desc" },
    include: {
      member: {
        select: { id: true, username: true, email: true },
      },
    },
  });
}
