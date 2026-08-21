import type { IssueState, Prisma } from "@prisma/client";
import { enqueueDomainEventTx, publishDomainEventLane } from "../../services/event-bus/outbox.js";
import type { WorkCaptureTransitionObservedPayload } from "../../services/event-bus/types.js";
import { AppError } from "../../shared/types.js";

export type TransitionObservationProject = {
  id: string;
  key: string;
  workspaceId: string;
};

export type TransitionObservationIssue = {
  id: string;
  key: string;
  state: IssueState;
};

export function transitionObservationLane(issueId: string): string {
  return `work-capture-transition:${issueId}`;
}

export async function enqueueTransitionObservationTx(
  transaction: Prisma.TransactionClient,
  input: {
    occurrenceId: string;
    issue: { id: string; key: string; from: IssueState; to: IssueState };
    project: TransitionObservationProject;
    memberId: string;
    actorUserId: string;
    observedAt: Date;
    cause?: string;
  }
): Promise<string> {
  const laneKey = transitionObservationLane(input.issue.id);
  const payload: WorkCaptureTransitionObservedPayload = {
    issueKey: input.issue.key,
    issueId: input.issue.id,
    projectId: input.project.id,
    projectKey: input.project.key,
    workspaceId: input.project.workspaceId,
    from: input.issue.from,
    to: input.issue.to,
    actorMemberId: input.memberId,
    actorUserId: input.actorUserId,
    observedAt: input.observedAt.toISOString(),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  };
  await enqueueDomainEventTx(transaction, {
    deliveryKey: `work-capture-transition:v1:${input.occurrenceId}`,
    laneKey,
    event: {
      type: "work_capture.transition_observed",
      workspaceId: input.project.workspaceId,
      actorId: input.memberId,
      payload: payload as unknown as Record<string, unknown>,
    },
  });
  return laneKey;
}

export async function publishTransitionObservationLanes(
  laneKeys: readonly string[]
): Promise<void> {
  await Promise.all(
    [...new Set(laneKeys)].map(async (laneKey) => {
      try {
        await publishDomainEventLane(laneKey);
      } catch (err) {
        console.error({ err, laneKey }, "work-capture transition observation delivery failed");
      }
    })
  );
}

export async function resolveTransitionObservationContext(
  transaction: Prisma.TransactionClient,
  memberId: string
): Promise<{ actorUserId: string; observedAt: Date }> {
  const member = await transaction.member.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  const [clock] = await transaction.$queryRaw<Array<{ observedAt: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "observedAt"
  `;
  if (!clock) throw new Error("Database clock query returned no row");
  return { actorUserId: member.userId, observedAt: clock.observedAt };
}
