import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DeleteIssueResult } from "@kanon/shared";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import { acquireExternalRefBackfillWriteGate } from "../integrations/backfill.js";
import { captureIntegrationWorkTx } from "../integrations/outbox.js";
import type { DeleteIssueBody } from "./schema.js";

const unsafeStates = ["leased", "ambiguous"] as const;
const supersedableStates = ["queued", "retry", "dead", "skipped"] as const;
const remotelyDeletableBootstrapStates = new Set(["not_required", "ready"]);

function isRetryableTransactionTimeout(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2028") {
    return false;
  }
  const meta = error.meta as { message?: unknown } | undefined;
  const message = [error.message, meta?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /timeout|timed out|expired/i.test(message);
}

export async function deleteIssue(
  issueId: string,
  authorizedKey: string,
  body: DeleteIssueBody,
  authorId: string,
  dependencies: { database?: typeof prisma } = {},
): Promise<DeleteIssueResult> {
  const database = dependencies.database ?? prisma;
  let result: DeleteIssueResult & { workspaceId: string; projectId: string; projectKey: string };

  // Resolve only the lock-order keys outside the transaction. The row is
  // re-fetched under lock below; this avoids issue→binding deadlocks with
  // ordinary captured mutations, which lock binding→issue.
  const target = await database.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  if (!target) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${authorizedKey}" not found`);
  }

  try {
    result = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT connection."id"
        FROM "integration_connections" AS connection
        JOIN "integration_project_bindings" AS binding
          ON binding."connection_id" = connection."id"
        WHERE binding."project_id" = ${target.projectId}::uuid
        ORDER BY connection."id"
        FOR UPDATE OF connection
      `;
      await transaction.$queryRaw`
        SELECT "id" FROM "integration_project_bindings"
        WHERE "project_id" = ${target.projectId}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      await acquireExternalRefBackfillWriteGate(transaction);
      await transaction.$queryRaw`
        SELECT "id" FROM "issues" WHERE "id" = ${issueId}::uuid FOR UPDATE
      `;
      const issue = await transaction.issue.findUnique({
        where: { id: issueId },
        include: {
          project: { select: { id: true, key: true, workspaceId: true } },
          children: { select: { id: true, key: true } },
          comments: { select: { id: true } },
          timeEntries: { select: { id: true } },
          _count: {
            select: {
              activityLogs: true,
              comments: true,
              documents: true,
              workLogs: true,
              workSessions: true,
              timeEntries: true,
              subscriptions: true,
            },
          },
        },
      });
      if (
        !issue ||
        issue.key !== authorizedKey ||
        issue.projectId !== target.projectId
      ) {
        throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${authorizedKey}" not found`);
      }
      if (issue.priority === "critical" && body.confirmationKey !== issue.key) {
        throw new AppError(
          400,
          "ISSUE_CONFIRMATION_KEY_MISMATCH",
          `Type the exact issue identifier "${issue.key}" to delete this critical issue.`,
        );
      }

      const descendantEntityFilters: Prisma.IntegrationSyncWorkWhereInput[] = [
        {
          entityType: "comment",
          entityId: { in: issue.comments.map(({ id }) => id) },
        },
        {
          entityType: "time_entry",
          entityId: { in: issue.timeEntries.map(({ id }) => id) },
        },
      ];
      const affectedEntities: Prisma.IntegrationSyncWorkWhereInput = {
        OR: [
          { entityType: "issue", entityId: issue.id },
          ...descendantEntityFilters,
        ],
      };

      const unsafe = await transaction.integrationSyncWork.findFirst({
        where: {
          ...affectedEntities,
          state: { in: [...unsafeStates] },
        },
        select: { id: true, entityType: true, operation: true, state: true },
      });
      if (unsafe) {
        const unresolvedIssueCreate =
          unsafe.entityType === "issue" && unsafe.operation === "create";
        throw new AppError(
          409,
          unresolvedIssueCreate ? "REMOTE_CREATE_UNRESOLVED" : "REMOTE_SYNC_IN_FLIGHT",
          unresolvedIssueCreate
            ? "The remote issue creation outcome is unresolved. Resolve synchronization before deleting locally."
            : "Remote synchronization is in flight or ambiguous. Retry deletion after it settles.",
          { workId: unsafe.id, state: unsafe.state },
        );
      }

      const references = await transaction.externalRef.findMany({
        where: {
          entityType: "issue",
          entityId: issue.id,
        },
        include: { binding: { include: { connection: true } } },
        orderBy: { id: "asc" },
      });
      const captures: Array<{
        ref: (typeof references)[number];
        credentialId: string;
      }> = [];
      for (const ref of references) {
        const { binding } = ref;
        if (binding.connection.provider !== "redmine") {
          throw new AppError(
            409,
            "EXTERNAL_REFERENCE_EXISTS",
            "The issue cannot be deleted while an external reference exists.",
          );
        }
        if (
          binding.projectId !== issue.projectId ||
          binding.connectionId !== ref.connectionId ||
          binding.lifecycle !== "active" ||
          binding.releaseRequestedAt !== null ||
          binding.releasedAt !== null ||
          !remotelyDeletableBootstrapStates.has(binding.bootstrapState) ||
          binding.connection.lifecycle !== "active" ||
          binding.connection.workspaceId !== issue.project.workspaceId
        ) {
          if (!remotelyDeletableBootstrapStates.has(binding.bootstrapState)) {
            throw new AppError(
              409,
              "REMOTE_DELETE_BOOTSTRAP_INCOMPLETE",
              "Wait for Redmine bootstrap to finish before deleting this linked issue.",
            );
          }
          throw new AppError(
            409,
            "REMOTE_DELETE_UNAVAILABLE",
            "The linked Redmine issue cannot be deleted while its integration is inactive or releasing.",
          );
        }
        const credential = await transaction.memberIntegrationCredential.findFirst({
          where: {
            memberId: authorId,
            connectionId: ref.connectionId,
            lastAuthStatus: "valid",
            revokedAt: null,
          },
          select: { id: true },
        });
        if (!credential) {
          throw new AppError(
            409,
            "REMOTE_DELETE_CREDENTIAL_REQUIRED",
            "Connect a valid Redmine account before deleting this linked issue.",
          );
        }
        captures.push({ ref, credentialId: credential.id });
      }

      await transaction.integrationSyncWork.updateMany({
        where: {
          entityType: "issue",
          entityId: issue.id,
          state: { in: [...supersedableStates] },
        },
        data: { state: "superseded", leaseToken: null, leaseUntil: null },
      });
      const supersededDescendantWork = await transaction.integrationSyncWork.updateMany({
        where: {
          OR: descendantEntityFilters,
          state: { in: [...supersedableStates] },
        },
        data: { state: "superseded", leaseToken: null, leaseUntil: null },
      });
      const deletedDescendantRefs = await transaction.externalRef.deleteMany({
        where: {
          OR: [
            {
              entityType: "comment",
              entityId: { in: issue.comments.map(({ id }) => id) },
            },
            {
              entityType: "time_entry",
              entityId: { in: issue.timeEntries.map(({ id }) => id) },
            },
          ],
        },
      });

      for (const { ref, credentialId } of captures) {
        await captureIntegrationWorkTx(transaction, {
          bindingId: ref.bindingId,
          entityType: "issue",
          entityId: issue.id,
          direction: "outbound",
          operation: "delete",
          actorKey: `member:${authorId}`,
          actorKind: "user",
          payload: {
            version: 1,
            refId: ref.id,
            externalId: ref.externalId,
            issueKey: issue.key,
          },
          correlationId: randomUUID(),
          refId: ref.id,
          authCredentialId: credentialId,
        });
      }

      const {
        timeEntries: detachedTimeEntryCount,
        ...cascadedRecordCounts
      } = issue._count;

      const audit = await transaction.adminAuditLog.create({
        data: {
          entityType: "issue",
          entityId: issue.id,
          action: "delete",
          authorId,
          payload: {
            issueSnapshot: {
              id: issue.id,
              key: issue.key,
              sequenceNum: issue.sequenceNum,
              title: issue.title,
              description: issue.description,
              type: issue.type,
              priority: issue.priority,
              state: issue.state,
              labels: issue.labels,
              completedAt: issue.completedAt,
              timeConfirmedAt: issue.timeConfirmedAt,
              projectId: issue.projectId,
              assigneeId: issue.assigneeId,
              cycleId: issue.cycleId,
              parentId: issue.parentId,
              roadmapItemId: issue.roadmapItemId,
              groupKey: issue.groupKey,
              engramContext: issue.engramContext,
              specArtifacts: issue.specArtifacts,
              estimate: issue.estimate,
              createdAt: issue.createdAt,
              updatedAt: issue.updatedAt,
            },
            childIssuesDetached: issue.children,
            cascadedRecordCounts,
            detachedRecordCounts: { timeEntries: detachedTimeEntryCount },
            remoteReferences: captures.map(({ ref }) => ({
              provider: ref.binding.connection.provider,
              connectionId: ref.connectionId,
              bindingId: ref.bindingId,
              refId: ref.id,
              externalId: ref.externalId,
            })),
            descendantIntegrationCleanup: {
              externalReferencesDeleted: deletedDescendantRefs.count,
              workItemsSuperseded: supersededDescendantWork.count,
            },
            remoteDeleteQueued: captures.length > 0,
          },
        },
        select: { id: true },
      });

      await transaction.issue.delete({ where: { id: issue.id } });
      return {
        auditLogId: audit.id,
        deletedIssueId: issue.id,
        deletedIssueKey: issue.key,
        remoteDeleteQueued: captures.length > 0,
        detachedTimeEntryCount,
        workspaceId: issue.project.workspaceId,
        projectId: issue.projectId,
        projectKey: issue.project.key,
      };
    }, { maxWait: 250, timeout: 30_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(
        404,
        "ISSUE_NOT_FOUND",
        "Issue not found (it may have been deleted concurrently).",
      );
    }
    if (isRetryableTransactionTimeout(error)) {
      throw new AppError(
        503,
        "CONCURRENCY_ERROR",
        "Issue deletion could not be serialized; retry the request.",
      );
    }
    throw error;
  }

  try {
    eventBus.emit({
      type: "issue.deleted",
      workspaceId: result.workspaceId,
      actorId: authorId,
      payload: {
        issueId: result.deletedIssueId,
        issueKey: result.deletedIssueKey,
        projectId: result.projectId,
        projectKey: result.projectKey,
        remoteDeleteQueued: result.remoteDeleteQueued,
      },
    });
  } catch {
    // Post-commit invalidation must never change the mutation result.
  }

  return {
    auditLogId: result.auditLogId,
    deletedIssueId: result.deletedIssueId,
    deletedIssueKey: result.deletedIssueKey,
    remoteDeleteQueued: result.remoteDeleteQueued,
    detachedTimeEntryCount: result.detachedTimeEntryCount,
  };
}
