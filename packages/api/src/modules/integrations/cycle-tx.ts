import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  captureIntegrationWorkTx,
  type IntegrationWorkOperation,
} from "./outbox.js";

type CycleRow = Prisma.CycleGetPayload<{}>;

export async function captureCycleMutationTx(
  transaction: Prisma.TransactionClient,
  cycle: CycleRow,
  actorId: string | null | undefined,
  operation: IntegrationWorkOperation,
) {
  const bindings = await transaction.integrationProjectBinding.findMany({
    where: {
      projectId: cycle.projectId,
      releaseRequestedAt: null,
      releasedAt: null,
      project: { archived: false },
    },
    orderBy: { id: "asc" },
    select: { id: true, connectionId: true },
  });
  if (bindings.length === 0) return [];

  const actor = actorId
    ? await transaction.member.findUnique({
        where: { id: actorId },
        select: { isAgent: true },
      })
    : null;
  const work: Awaited<ReturnType<typeof captureIntegrationWorkTx>>[] = [];
  for (const binding of bindings) {
    const [credential, reference] = await Promise.all([
      actorId
        ? transaction.memberIntegrationCredential.findFirst({
          where: {
            memberId: actorId,
            connectionId: binding.connectionId,
            lastAuthStatus: "valid",
            revokedAt: null,
          },
          select: { id: true },
        })
        : null,
      transaction.externalRef.findFirst({
        where: {
          bindingId: binding.id,
          entityType: "cycle",
          entityId: cycle.id,
        },
        select: { id: true },
      }),
    ]);

    work.push(
      await captureIntegrationWorkTx(transaction, {
        bindingId: binding.id,
        entityType: "cycle",
        entityId: cycle.id,
        direction: "outbound",
        operation,
        actorKey: actorId ? `member:${actorId}` : "system:cycle",
        actorKind: actorId ? (actor?.isAgent ? "ai" : "user") : "system",
        correlationId: randomUUID(),
        payload: {
          version: 1,
          cycle: {
            id: cycle.id,
            projectId: cycle.projectId,
            name: cycle.name,
            goal: cycle.goal,
            state: cycle.state,
            startDate: cycle.startDate.toISOString(),
            endDate: cycle.endDate.toISOString(),
            velocity: cycle.velocity,
            closedAt: cycle.closedAt?.toISOString() ?? null,
            updatedAt: cycle.updatedAt.toISOString(),
          },
        },
        refId: reference?.id,
        ...(actorId && !actor?.isAgent && credential
          ? { authCredentialId: credential.id }
          : {}),
      }),
    );
  }

  return work;
}
