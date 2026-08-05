import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { encodeIssueSearchCursor } from "./cursor.js";
import { IssueSearchInputSchema, IssueSearchResponseSchema } from "./contracts.js";
import { sourceVersion, sourceHash } from "./source.js";
import { AppError } from "../../shared/types.js";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";

export function normalizeSearchQuery(q: string): string[] {
  const normalized = q.normalize("NFKC").trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.slice(0, 12);
}

export async function searchIssues(
  workspaceId: string,
  userId: string,
  input: z.infer<typeof IssueSearchInputSchema>
): Promise<z.infer<typeof IssueSearchResponseSchema>> {
  const deadlineMs = Math.max(10, Math.min(5000, input.deadlineMs ?? 900));
  const scopeKind = input.scope?.kind ?? "project";
  const tokens = normalizeSearchQuery(input.q);

  if (tokens.length === 0) {
    throw new AppError(400, "INVALID_QUERY", "Search query contains no valid tokens");
  }

  const limit = Math.max(1, Math.min(10, input.limit ?? 10));
  const fetchLimit = limit + 1;

  return await prisma.$transaction(
    async (tx) => {
      // 1. Target issue anchoring / project resolving
      let targetProjectId: string | null = null;
      let targetIssueObj: any = null;

      if (input.targetIssueId) {
        targetIssueObj = await tx.issue.findUnique({
          where: { id: input.targetIssueId },
          include: { project: true },
        });
        if (!targetIssueObj || targetIssueObj.project.workspaceId !== workspaceId) {
          throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Target issue not found");
        }
        targetProjectId = targetIssueObj.projectId;
      }

      // Project scope is target-anchored (contract scope.kind=project has no projectId).
      if (input.scope?.kind === "project" && !targetProjectId) {
        throw new AppError(
          400,
          "SCOPE_MISMATCH",
          "Project scope requires targetIssueId to resolve the project",
        );
      }

      const projectIdCondition = targetProjectId
        ? Prisma.sql`AND p.id = ${targetProjectId}::uuid`
        : Prisma.empty;

      const targetExclusion = input.targetIssueId
        ? Prisma.sql`AND i.id != ${input.targetIssueId}::uuid`
        : Prisma.empty;

      const queryPattern = `%${tokens.join("%")}%`;

      const searchSql = Prisma.sql`
        WITH authorized_projects AS (
          SELECT p.id
          FROM projects p
          WHERE p.workspace_id = ${workspaceId}::uuid
            ${projectIdCondition}
            AND (
              EXISTS (
                SELECT 1 FROM members m
                WHERE m.user_id = ${userId}::uuid
                  AND m.workspace_id = ${workspaceId}::uuid
                  AND m.role IN ('owner', 'admin')
              ) OR EXISTS (
                SELECT 1 FROM project_members pm
                WHERE pm.project_id = p.id AND pm.user_id = ${userId}::uuid
              )
            )
        )
        SELECT
          i.id AS "issueId",
          i.key AS "issueKey",
          i.title,
          i.description,
          i.type,
          i.priority,
          i.state,
          i.labels,
          i.group_key AS "groupKey",
          i.assignee_id AS "assigneeId",
          i.cycle_id AS "cycleId",
          i.parent_id AS "parentId",
          i.created_at AS "createdAt",
          i.updated_at AS "updatedAt",
          p.id AS "projectId",
          p.key AS "projectKey",
          p.name AS "projectName",
          p.updated_at AS "projectUpdatedAt",
          CASE
            WHEN LOWER(i.key) = LOWER(${input.q}) THEN 1
            WHEN LOWER(i.key) LIKE LOWER(${input.q + '%'}) THEN 2
            WHEN LOWER(i.title) = LOWER(${input.q}) THEN 3
            WHEN LOWER(i.title) LIKE LOWER(${'%' + input.q + '%'}) THEN 4
            ELSE 5
          END AS match_rank
        FROM issues i
        JOIN projects p ON i.project_id = p.id
        JOIN authorized_projects ap ON ap.id = p.id
        WHERE (LOWER(i.title) LIKE LOWER(${queryPattern}) OR LOWER(i.key) LIKE LOWER(${queryPattern}))
          ${targetExclusion}
        ORDER BY match_rank ASC, i.title ASC, i.key ASC, i.id ASC
        LIMIT ${fetchLimit}
      `;

      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${deadlineMs}`);
      const rows = await tx.$queryRaw<any[]>(searchSql);

      const hasMore = rows.length > limit;
      const returnedRawRows = rows.slice(0, limit);

      const returnedCandidateRows = returnedRawRows.map((r, idx) => {
        const sVersion = sourceVersion(r.updatedAt, r.projectUpdatedAt);
        const sHash = sourceHash({
          workspaceId,
          projectId: r.projectId,
          issueId: r.issueId,
          issueKey: r.issueKey,
          projectKey: r.projectKey,
          title: r.title,
          description: r.description,
          type: r.type,
          priority: r.priority,
          state: r.state,
          labels: r.labels ?? [],
          groupId: r.groupKey ?? null,
          assigneeId: r.assigneeId ?? null,
          cycleId: r.cycleId ?? null,
          parentId: r.parentId ?? null,
          issueUpdatedAt: r.updatedAt,
          projectUpdatedAt: r.projectUpdatedAt,
        });

        return {
          issueId: r.issueId,
          issueKey: r.issueKey,
          projectId: r.projectId,
          projectKey: r.projectKey,
          title: r.title,
          state: r.state,
          type: r.type ?? null,
          priority: r.priority ?? null,
          labels: Array.isArray(r.labels) ? r.labels.slice(0, 8) : [],
          groupKey: r.groupKey ?? null,
          assigneeId: r.assigneeId ?? null,
          cycleId: r.cycleId ?? null,
          createdAt: new Date(r.createdAt).toISOString(),
          updatedAt: new Date(r.updatedAt).toISOString(),
          rank: idx + 1,
          sourceVersion: sVersion,
          sourceHash: sHash,
        };
      });

      // Compute population fingerprint over all matching rows
      const fingerprintInput = rows
        .map((r) => `${r.issueId}:${r.updatedAt.toISOString()}:${r.projectId}:${r.projectUpdatedAt.toISOString()}`)
        .sort()
        .join(",");
      const populationFingerprint = createHash("md5").update(fingerprintInput || "empty").digest("hex");

      const effectiveScope = targetProjectId
        ? ({ kind: "project", workspaceId, projectId: targetProjectId } as const)
        : ({ kind: "workspace", workspaceId } as const);

      const nextCursor = hasMore
        ? encodeIssueSearchCursor(
            {
              workspaceId,
              query: input.q,
              populationFingerprint,
              lastIssueId: returnedRawRows[returnedRawRows.length - 1].issueId,
              authzPolicyVersion: "authz-policy.v1",
            },
            process.env["JWT_SECRET"] ?? "kanon-secret-key"
          )
        : undefined;

      const response: z.infer<typeof IssueSearchResponseSchema> = {
        contractVersion: "issue-search.v1",
        orderingVersion: "issue-search.v1",
        completeness: hasMore ? "bounded" : "complete",
        limit,
        returnedCount: returnedCandidateRows.length,
        effectiveScope,
        correlationId: randomUUID(),
        degradation: [],
        rows: returnedCandidateRows,
        ...(nextCursor ? { nextCursor } : {}),
      };

      return response;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}
