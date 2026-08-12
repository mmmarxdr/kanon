import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import {
  AUTHORIZATION_POLICY_VERSION,
  canonicalJson,
  canonicalJsonBytes,
  sha256Hex,
} from "./canonical.js";
import { IssueSearchInputSchema, IssueSearchResponseSchema } from "./contracts.js";
import { decodeIssueSearchCursor, encodeIssueSearchCursor } from "./cursor.js";
import { sourceHash, sourceVersion } from "./source.js";

type SearchInput = z.infer<typeof IssueSearchInputSchema>;
export const SEARCH_LOGICAL_SCANNED = Symbol("searchLogicalScanned");
type SearchResponse = z.infer<typeof IssueSearchResponseSchema> & {
  readonly [SEARCH_LOGICAL_SCANNED]?: number;
};

interface SearchCursor {
  readonly version: 1;
  readonly workspaceId: string;
  readonly userId: string;
  readonly query: string;
  readonly scope: "project" | "workspace";
  readonly projection: "compact" | "full";
  readonly filters: {
    readonly state: string | null;
    readonly type: string | null;
    readonly priority: string | null;
    readonly label: string | null;
    readonly group: string | null;
    readonly assignee: string | null;
    readonly cycle: string | null;
  };
  readonly targetIssueId: string | null;
  readonly limit: number;
  readonly allowedProjectIdsDigest: string;
  readonly authorizationPolicyVersion: string;
  readonly populationFingerprint: string;
  readonly offset: number;
  readonly last: {
    readonly matchRank: number;
    readonly tokenOverlap: number;
    readonly normalizedTitle: string;
    readonly issueKey: string;
    readonly issueId: string;
  };
}

interface SearchSqlRow {
  issueId: string | null;
  issueKey: string | null;
  title: string | null;
  description: string | null;
  type: string | null;
  priority: string | null;
  state: string | null;
  labels: string[] | null;
  groupKey: string | null;
  assigneeId: string | null;
  cycleId: string | null;
  parentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  projectId: string | null;
  projectKey: string | null;
  projectUpdatedAt: Date | null;
  matchRank: number | null;
  tokenOverlap: number | null;
  normalizedTitle: string | null;
  populationFingerprint: string;
  logicalScanned: number;
}

export function normalizeSearchQuery(q: string): string[] {
  const normalized = q.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!normalized) return [];
  return normalized.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
}

function normalizedFilters(filters: SearchInput["filters"]): SearchCursor["filters"] {
  return {
    state: filters?.state ?? null,
    type: filters?.type ?? null,
    priority: filters?.priority ?? null,
    label: filters?.label ?? null,
    group: filters?.group ?? null,
    assignee: filters?.assignee ?? null,
    cycle: filters?.cycle ?? null,
  };
}

function boundedText(value: string, maxUnits: number): string {
  const bounded = value.slice(0, maxUnits);
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
}

function parseSearchCursor(
  token: string,
  expected: Omit<SearchCursor, "populationFingerprint" | "offset" | "last">,
): SearchCursor {
  let cursor: SearchCursor;
  try {
    cursor = decodeIssueSearchCursor<SearchCursor>(token, env.JWT_SECRET);
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "Issue search cursor is invalid");
  }
  const { populationFingerprint, offset, last, ...binding } = cursor;
  if (
    canonicalJson(binding) !== canonicalJson(expected) ||
    typeof populationFingerprint !== "string" ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !last ||
    !Number.isInteger(last.matchRank) ||
    !Number.isInteger(last.tokenOverlap) ||
    typeof last.normalizedTitle !== "string" ||
    typeof last.issueKey !== "string" ||
    typeof last.issueId !== "string"
  ) {
    throw new AppError(400, "CURSOR_BINDING_MISMATCH", "Issue search cursor does not match the query");
  }
  return cursor;
}

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; meta?: unknown };
  const meta = value.meta && typeof value.meta === "object"
    ? value.meta as { code?: unknown; message?: unknown }
    : {};
  return value.code === "SEARCH_TIMED_OUT" || value.code === "P2024" || value.code === "P2028" ||
    meta.code === "57014" || /statement timeout|canceling statement|57014/i.test(
    [value.message, meta.message].filter((item) => typeof item === "string").join(" "),
  );
}

export async function searchIssues(
  workspaceId: string,
  userId: string,
  input: SearchInput,
  allowedProjectIds: readonly string[] | undefined = undefined,
  correlationId: string = randomUUID(),
): Promise<SearchResponse> {
  const deadlineMs = Math.max(100, Math.min(900, input.deadlineMs ?? 900));
  const deadlineAt = performance.now() + deadlineMs;
  const scopeKind = input.scope?.kind ?? "project";
  const normalizedQuery = input.q.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  const tokens = normalizeSearchQuery(input.q);
  if (tokens.length === 0) {
    throw new AppError(400, "INVALID_QUERY", "Search query contains no valid tokens");
  }
  if (input.scope?.kind === "workspace" && input.scope.workspaceId !== workspaceId) {
    throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Workspace not found");
  }

  const limit = input.limit ?? 10;
  const cursorBinding = {
    version: 1 as const,
    workspaceId,
    userId,
    query: tokens.join(" "),
    scope: scopeKind,
    projection: input.projection,
    filters: normalizedFilters(input.filters),
    targetIssueId: input.targetIssueId ?? null,
    limit,
    allowedProjectIdsDigest: sha256Hex(canonicalJsonBytes(
      allowedProjectIds?.length ? [...allowedProjectIds].sort() : null,
    )),
    authorizationPolicyVersion: AUTHORIZATION_POLICY_VERSION,
  };
  const cursor = input.cursor ? parseSearchCursor(input.cursor, cursorBinding) : null;

  try {
    return await prisma.$transaction(async (tx) => {
      const setRemainingDeadline = async () => {
        const remaining = Math.floor(deadlineAt - performance.now());
        if (remaining < 1) {
          throw new AppError(503, "SEARCH_TIMED_OUT", "Issue search deadline exceeded");
        }
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${`${remaining}ms`}, true)`;
      };
      await setRemainingDeadline();

      let targetProjectId: string | null = null;
      if (input.targetIssueId) {
        const target = await tx.issue.findUnique({
          where: { id: input.targetIssueId },
          select: { projectId: true, project: { select: { workspaceId: true, archived: true } } },
        });
        const tokenAllowsTarget = target && (
          !allowedProjectIds?.length || allowedProjectIds.includes(target.projectId)
        );
        let authorized = false;
        if (target && !target.project.archived && tokenAllowsTarget && target.project.workspaceId === workspaceId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
            select: { role: true, projectAccess: true },
          });
          authorized = !!member && (
            member.role === "owner" ||
            member.role === "admin" ||
            member.projectAccess === "workspace" ||
            !!(await tx.projectMember.findUnique({
              where: { userId_projectId: { userId, projectId: target.projectId } },
              select: { id: true },
            }))
          );
        }
        if (!target || !authorized) {
          throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Target issue not found");
        }
        targetProjectId = target.projectId;
      }
      if (scopeKind === "project" && !targetProjectId) {
        throw new AppError(
          400,
          "SCOPE_MISMATCH",
          "Project scope requires targetIssueId to resolve the project",
        );
      }
      await setRemainingDeadline();

      const projectPredicate = scopeKind === "project" && targetProjectId
        ? Prisma.sql`AND p.id = ${targetProjectId}::uuid`
        : Prisma.empty;
      const tokenPredicate = !allowedProjectIds?.length
        ? Prisma.empty
        : Prisma.sql`AND p.id IN (${Prisma.join(
            allowedProjectIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`;
      const targetPredicate = input.targetIssueId
        ? Prisma.sql`AND i.id <> ${input.targetIssueId}::uuid`
        : Prisma.empty;
      const tokenMatchPredicate = Prisma.sql`(${Prisma.join(tokens.map((token) => {
        const pattern = `%${token}%`;
        return Prisma.sql`(LOWER(i.title) LIKE ${pattern} OR LOWER(i.key) LIKE ${pattern})`;
      }), " OR ")})`;
      const allTitleTokens = Prisma.join(tokens.map((token) =>
        Prisma.sql`LOWER(i.title) LIKE ${`%${token}%`}`), " AND ");
      const tokenOverlap = Prisma.join(tokens.map((token) =>
        Prisma.sql`CASE WHEN LOWER(i.title) LIKE ${`%${token}%`} OR LOWER(i.key) LIKE ${`%${token}%`} THEN 1 ELSE 0 END`), " + ");
      const filters = normalizedFilters(input.filters);
      const filterPredicate = Prisma.sql`
        ${filters.state ? Prisma.sql`AND i.state::text = ${filters.state}` : Prisma.empty}
        ${filters.type ? Prisma.sql`AND i.type::text = ${filters.type}` : Prisma.empty}
        ${filters.priority ? Prisma.sql`AND i.priority::text = ${filters.priority}` : Prisma.empty}
        ${filters.label ? Prisma.sql`AND i.labels @> ARRAY[${filters.label}]::text[]` : Prisma.empty}
        ${filters.group ? Prisma.sql`AND i.group_key = ${filters.group}` : Prisma.empty}
        ${filters.assignee ? Prisma.sql`AND i.assignee_id = ${filters.assignee}::uuid` : Prisma.empty}
        ${filters.cycle ? Prisma.sql`AND i.cycle_id = ${filters.cycle}::uuid` : Prisma.empty}
      `;
      const seekPredicate = cursor
        ? Prisma.sql`WHERE (
            page."matchRank" > ${cursor.last.matchRank} OR
            (page."matchRank" = ${cursor.last.matchRank} AND page."tokenOverlap" < ${cursor.last.tokenOverlap}) OR
            (page."matchRank" = ${cursor.last.matchRank} AND page."tokenOverlap" = ${cursor.last.tokenOverlap} AND page."normalizedTitle" > ${cursor.last.normalizedTitle}) OR
            (page."matchRank" = ${cursor.last.matchRank} AND page."tokenOverlap" = ${cursor.last.tokenOverlap} AND page."normalizedTitle" = ${cursor.last.normalizedTitle} AND page."issueKey" > ${cursor.last.issueKey}) OR
            (page."matchRank" = ${cursor.last.matchRank} AND page."tokenOverlap" = ${cursor.last.tokenOverlap} AND page."normalizedTitle" = ${cursor.last.normalizedTitle} AND page."issueKey" = ${cursor.last.issueKey} AND page."issueId" > ${cursor.last.issueId}::uuid)
          )`
        : Prisma.empty;
      const queryText = normalizedQuery;
      const likeQueryText = queryText.replace(/[!%_]/gu, "!$&");
      const rows = await tx.$queryRaw<SearchSqlRow[]>(Prisma.sql`
        WITH authorized_projects AS (
          SELECT p.id
          FROM projects p
          WHERE p.workspace_id = ${workspaceId}::uuid
            AND p.archived = FALSE
            ${projectPredicate}
            ${tokenPredicate}
            AND (
              EXISTS (
                SELECT 1 FROM members m
                WHERE m.user_id = ${userId}::uuid
                  AND m.workspace_id = ${workspaceId}::uuid
                  AND (m.role IN ('owner', 'admin') OR m.project_access = 'workspace')
              ) OR EXISTS (
                SELECT 1 FROM project_members pm
                WHERE pm.project_id = p.id AND pm.user_id = ${userId}::uuid
              )
            )
        ), matches AS (
          SELECT
            i.id AS "issueId", i.key AS "issueKey", i.title, i.description,
            i.type::text AS type, i.priority::text AS priority, i.state::text AS state,
            i.labels, i.group_key AS "groupKey", i.assignee_id AS "assigneeId",
            i.cycle_id AS "cycleId", i.parent_id AS "parentId",
            i.created_at AS "createdAt", i.updated_at AS "updatedAt",
            p.id AS "projectId", p.key AS "projectKey", p.updated_at AS "projectUpdatedAt",
            LOWER(i.title) AS "normalizedTitle",
            (${tokenOverlap})::integer AS "tokenOverlap",
            CASE
              WHEN LOWER(i.key) = ${queryText} THEN 1
              WHEN LOWER(i.key) LIKE ${`${likeQueryText}%`} ESCAPE '!' THEN 2
              WHEN LOWER(i.title) = ${queryText} THEN 3
              WHEN ${allTitleTokens} THEN 4
              WHEN LOWER(i.title) LIKE ${`%${likeQueryText}%`} ESCAPE '!'
                OR LOWER(i.key) LIKE ${`%${likeQueryText}%`} ESCAPE '!' THEN 5
              ELSE 6
            END AS "matchRank"
          FROM issues i
          JOIN projects p ON i.project_id = p.id
          JOIN authorized_projects authorized ON authorized.id = p.id
          WHERE ${tokenMatchPredicate} ${targetPredicate} ${filterPredicate}
        ), metadata AS (
          SELECT md5(COALESCE(string_agg(
            concat_ws(':', matches."issueId"::text, matches."updatedAt"::text,
              matches."projectId"::text, matches."projectUpdatedAt"::text),
            ',' ORDER BY matches."issueId"
          ), 'empty')) AS population_fingerprint,
          COUNT(*)::integer AS logical_scanned
          FROM matches
        )
        SELECT page.*, metadata.population_fingerprint AS "populationFingerprint",
          metadata.logical_scanned AS "logicalScanned"
        FROM metadata
        LEFT JOIN LATERAL (
          SELECT * FROM matches page
          ${seekPredicate}
          ORDER BY page."matchRank", page."tokenOverlap" DESC, page."normalizedTitle", page."issueKey", page."issueId"
          LIMIT ${limit + 1}
        ) page ON TRUE
        ORDER BY page."matchRank" NULLS LAST, page."tokenOverlap" DESC, page."normalizedTitle", page."issueKey", page."issueId"
      `);
      const populationFingerprint = rows[0]?.populationFingerprint ?? "";
      if (cursor && cursor.populationFingerprint !== populationFingerprint) {
        throw new AppError(409, "CURSOR_SOURCE_CONFLICT", "Issue search changed; restart search");
      }
      const matches = rows.filter((row): row is SearchSqlRow & {
        issueId: string;
        issueKey: string;
        title: string;
        state: string;
        createdAt: Date;
        updatedAt: Date;
        projectId: string;
        projectKey: string;
        projectUpdatedAt: Date;
        matchRank: number;
        tokenOverlap: number;
        normalizedTitle: string;
      } => row.issueId !== null && row.issueKey !== null && row.title !== null && row.state !== null &&
        row.createdAt !== null && row.updatedAt !== null && row.projectId !== null &&
        row.projectKey !== null && row.projectUpdatedAt !== null && row.matchRank !== null &&
        row.tokenOverlap !== null && row.normalizedTitle !== null);
      const hasMore = matches.length > limit;
      const page = matches.slice(0, limit);
      const offset = cursor?.offset ?? 0;
      const resultRows = page.map((row, index) => ({
        issueId: row.issueId,
        issueKey: row.issueKey,
        projectId: row.projectId,
        projectKey: row.projectKey,
        title: boundedText(row.title, 500),
        state: row.state,
        type: row.type,
        priority: row.priority,
        labels: Array.isArray(row.labels) ? row.labels.slice(0, 8) : [],
        groupKey: row.groupKey,
        assigneeId: row.assigneeId,
        cycleId: row.cycleId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        rank: offset + index + 1,
        sourceVersion: sourceVersion(row.updatedAt, row.projectUpdatedAt),
        sourceHash: sourceHash({
          workspaceId,
          projectId: row.projectId,
          issueId: row.issueId,
          issueKey: row.issueKey,
          projectKey: row.projectKey,
          title: row.title,
          description: row.description,
          type: row.type,
          priority: row.priority,
          state: row.state,
          labels: row.labels ?? [],
          groupId: row.groupKey,
          assigneeId: row.assigneeId,
          cycleId: row.cycleId,
          parentId: row.parentId,
          issueUpdatedAt: row.updatedAt,
          projectUpdatedAt: row.projectUpdatedAt,
        }),
        ...(input.projection === "full"
          ? { descriptionExcerpt: boundedText(row.description ?? "", 240) }
          : {}),
      }));
      const last = page.at(-1);
      const effectiveScope = scopeKind === "project" && targetProjectId
        ? ({ kind: "project", workspaceId, projectId: targetProjectId } as const)
        : ({ kind: "workspace", workspaceId } as const);
      const response = IssueSearchResponseSchema.parse({
        contractVersion: "issue-search.v1",
        orderingVersion: "issue-search.v1",
        completeness: hasMore ? "bounded" : "complete",
        limit,
        returnedCount: resultRows.length,
        effectiveScope,
        correlationId,
        degradation: [],
        rows: resultRows,
        ...(hasMore && last
          ? {
              nextCursor: encodeIssueSearchCursor({
                ...cursorBinding,
                populationFingerprint,
                offset: offset + resultRows.length,
                last: {
                  matchRank: last.matchRank,
                  tokenOverlap: last.tokenOverlap,
                  normalizedTitle: last.normalizedTitle,
                  issueKey: last.issueKey,
                  issueId: last.issueId,
                },
              }, env.JWT_SECRET),
            }
          : {}),
      });
      Object.defineProperty(response, SEARCH_LOGICAL_SCANNED, {
        value: rows[0]?.logicalScanned ?? 0,
        enumerable: false,
      });
      return response as SearchResponse;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: deadlineMs,
      timeout: deadlineMs,
    });
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new AppError(503, "SEARCH_TIMED_OUT", "Issue search deadline exceeded");
    }
    throw error;
  }
}
