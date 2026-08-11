import { Prisma } from "@prisma/client";
import type { DeleteIssueResult } from "@kanon/shared";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import { acquireExternalRefBackfillWriteGate } from "../integrations/backfill.js";
import type { DeleteIssueBody } from "./schema.js";

const unsafeStates = ["leased", "ambiguous"] as const;
const supersedableStates = ["queued", "retry", "dead", "skipped"] as const;

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

      const unsafe = await transaction.integrationSyncWork.findFirst({
        where: {
          entityType: "issue",
          entityId: issue.id,
          state: { in: [...unsafeStates] },
        },
        select: { id: true, operation: true, state: true },
      });
      if (unsafe) {
        throw new AppError(
          409,
          unsafe.operation === "create" ? "REMOTE_CREATE_UNRESOLVED" : "REMOTE_SYNC_IN_FLIGHT",
          unsafe.operation === "create"
            ? "The remote issue creation outcome is unresolved. Resolve synchronization before deleting locally."
            : "Remote synchronization is in flight or ambiguous. Retry deletion after it settles.",
          { workId: unsafe.id, state: unsafe.state },
        );
      }

      const linkedReferences = await transaction.externalRef.findMany({
        where: {
          entityType: "issue",
          entityId: issue.id,
        },
        select: { connection: { select: { provider: true } } },
      });
      if (linkedReferences.some(({ connection }) => connection.provider === "redmine")) {
        throw new AppError(
          409,
          "REMOTE_DELETE_UNAVAILABLE",
          "The linked Redmine issue cannot be deleted until durable remote deletion is available.",
        );
      }
      if (linkedReferences.length > 0) {
        throw new AppError(
          409,
          "EXTERNAL_REFERENCE_EXISTS",
          "The issue cannot be deleted while an external reference exists.",
        );
      }

      await transaction.integrationSyncWork.updateMany({
        where: {
          entityType: "issue",
          entityId: issue.id,
          state: { in: [...supersedableStates] },
        },
        data: { state: "superseded", leaseToken: null, leaseUntil: null },
      });

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
            remoteReferences: [],
            remoteDeleteQueued: false,
          },
        },
        select: { id: true },
      });

      await transaction.issue.delete({ where: { id: issue.id } });
      return {
        auditLogId: audit.id,
        deletedIssueId: issue.id,
        deletedIssueKey: issue.key,
        remoteDeleteQueued: false,
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
