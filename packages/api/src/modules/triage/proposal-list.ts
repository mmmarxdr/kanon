import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import {
  AUTHORIZATION_POLICY_VERSION,
  TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION,
  canonicalJsonBytes,
  sha256Hex,
} from "./canonical.js";
import { decodeProposalListCursor, encodeProposalListCursor } from "./cursor.js";

export type ListStateFilter =
  | "current"
  | "superseded"
  | "expired"
  | "dismissed"
  | "disposed"
  | "all";

export interface ListTriageProposalsQuery {
  state?: ListStateFilter;
  limit?: number;
  targetIssueKey?: string;
  targetIssueId?: string;
  generatorSource?: "deterministic_policy" | "host_ai" | "mixed";
  degraded?: boolean;
  cursor?: string;
}

interface ListCursor {
  readonly version: 1;
  readonly projectId: string;
  readonly userId: string;
  readonly state: ListStateFilter;
  readonly targetIssueKey: string | null;
  readonly targetIssueId: string | null;
  readonly generatorSource: string | null;
  readonly degraded: boolean | null;
  readonly authorizationContext: string;
  readonly authorizationPolicyVersion: string;
  readonly sourceFingerprint: string;
  readonly snapshotAt: string;
  readonly lastCreatedAt: string;
  readonly lastId: string;
}

type CursorBinding = Omit<
  ListCursor,
  "sourceFingerprint" | "snapshotAt" | "lastCreatedAt" | "lastId"
>;

function parseCursor(token: string, expected: CursorBinding): ListCursor {
  let cursor: ListCursor;
  try {
    cursor = decodeProposalListCursor<ListCursor>(token, env.JWT_SECRET);
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "Proposal cursor is invalid");
  }
  if (
    cursor.version !== expected.version ||
    cursor.projectId !== expected.projectId ||
    cursor.userId !== expected.userId ||
    cursor.state !== expected.state ||
    cursor.targetIssueKey !== expected.targetIssueKey ||
    cursor.targetIssueId !== expected.targetIssueId ||
    cursor.generatorSource !== expected.generatorSource ||
    cursor.degraded !== expected.degraded ||
    cursor.authorizationContext !== expected.authorizationContext ||
    cursor.authorizationPolicyVersion !== expected.authorizationPolicyVersion ||
    typeof cursor.sourceFingerprint !== "string" ||
    !Number.isFinite(new Date(cursor.snapshotAt).getTime()) ||
    !Number.isFinite(new Date(cursor.lastCreatedAt).getTime()) ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(cursor.lastId)
  ) {
    throw new AppError(400, "CURSOR_BINDING_MISMATCH", "Proposal cursor does not match the query");
  }
  return cursor;
}

function statePredicate(state: ListStateFilter, snapshotAt: Date): Prisma.Sql {
  if (state === "current") {
    return Prisma.sql`e.snapshot_lifecycle = 'pending' AND e.expires_at > ${snapshotAt} AND e.successor_id IS NULL`;
  }
  if (state === "superseded") {
    return Prisma.sql`e.snapshot_lifecycle = 'pending' AND e.expires_at > ${snapshotAt} AND e.successor_id IS NOT NULL`;
  }
  if (state === "expired") {
    return Prisma.sql`(e.snapshot_lifecycle = 'expired' OR (e.snapshot_lifecycle = 'pending' AND e.expires_at <= ${snapshotAt})) AND e.disposed_at IS NULL`;
  }
  if (state === "dismissed") {
    return Prisma.sql`e.snapshot_lifecycle = 'dismissed' AND e.disposed_at IS NULL`;
  }
  if (state === "disposed") {
    return Prisma.sql`e.snapshot_lifecycle = 'disposed' AND e.disposition_list_visible = TRUE`;
  }
  return Prisma.sql`(e.snapshot_lifecycle <> 'disposed' OR e.disposition_list_visible = TRUE)`;
}

function effectiveState(
  lifecycle: string,
  expiresAt: Date,
  snapshotAt: Date,
  superseded: boolean,
): "current" | "superseded" | "dismissed" | "expired" | "disposed" {
  if (lifecycle === "disposed" || lifecycle === "dismissed" || lifecycle === "expired") {
    return lifecycle;
  }
  if (expiresAt <= snapshotAt) return "expired";
  return superseded ? "superseded" : "current";
}

function compactSummary(summary: Prisma.JsonValue): Prisma.JsonValue {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const value = summary as Prisma.JsonObject;
  const policy = value["policy"] && typeof value["policy"] === "object" && !Array.isArray(value["policy"])
    ? value["policy"] as Prisma.JsonObject
    : null;
  const model = value["model"] && typeof value["model"] === "object" && !Array.isArray(value["model"])
    ? value["model"] as Prisma.JsonObject
    : null;
  const boundedString = (input: Prisma.JsonValue | undefined, max: number) => {
    if (typeof input !== "string") return undefined;
    const bounded = input.slice(0, max);
    const last = bounded.charCodeAt(bounded.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
  };
  const boundedStrings = (input: Prisma.JsonValue | undefined, maxItems: number, maxLength: number) =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string")
        .slice(0, maxItems)
        .map((item) => boundedString(item, maxLength) ?? "")
      : undefined;
  return {
    targetIssueKey: boundedString(value["targetIssueKey"], 120),
    actionKinds: boundedStrings(value["actionKinds"], 10, 40),
    generatorSource: boundedString(value["generatorSource"], 32),
    ...(policy ? { policy: {
      id: boundedString(policy["id"], 200),
      version: boundedString(policy["version"], 200),
    } } : {}),
    ...(model ? { model: {
      provider: boundedString(model["provider"], 200),
      model: boundedString(model["model"], 200),
      modelVersion: boundedString(model["modelVersion"], 200),
    } } : {}),
    confidenceBands: boundedStrings(value["confidenceBands"], 3, 6),
    degraded: value["degraded"] === true,
    degradationCategories: boundedStrings(value["degradationCategories"], 8, 80),
  };
}

function isListTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; meta?: unknown };
  const meta = value.meta && typeof value.meta === "object"
    ? value.meta as { code?: unknown; message?: unknown }
    : {};
  const message = [value.message, meta.message].filter((item) => typeof item === "string").join(" ");
  return value.code === "P2024" || (value.code === "P2028" && /timeout|expired/i.test(message)) ||
    meta.code === "57014" || /statement timeout|canceling statement|57014/i.test(message);
}

export function buildVisibleProposalsCte(params: {
  projectId: string;
  snapshotAt: Date;
  targetPredicate: Prisma.Sql;
  generatorPredicate: Prisma.Sql;
  degradedPredicate: Prisma.Sql;
}): Prisma.Sql {
  const { projectId, snapshotAt, targetPredicate, generatorPredicate, degradedPredicate } = params;
  return Prisma.sql`
      visible AS (
        SELECT tp.*,
          COALESCE((
            SELECT event.state::text
            FROM triage_proposal_lifecycle_events event
            WHERE event.proposal_id = tp.id AND event.created_at <= ${snapshotAt}
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT 1
          ), tp.lifecycle::text) AS snapshot_lifecycle,
          (
            SELECT child.id FROM triage_proposals child
            WHERE child.supersedes_id = tp.id AND child.created_at <= ${snapshotAt}
            ORDER BY child.created_at, child.id
            LIMIT 1
          ) AS successor_id
        FROM triage_proposals tp
        JOIN issues i ON i.id = tp.target_issue_id AND i.project_id = tp.project_id
        WHERE tp.project_id = ${projectId}::uuid
          AND tp.created_at <= ${snapshotAt}
          ${targetPredicate}
          ${generatorPredicate}
          ${degradedPredicate}
      )
    `;
}

export function buildProposalListPageStatement(params: {
  visibleCte: Prisma.Sql;
  state: ListStateFilter;
  snapshotAt: Date;
  seekPredicate: Prisma.Sql;
  limit: number;
}): Prisma.Sql {
  const { visibleCte, state, snapshotAt, seekPredicate, limit } = params;
  return Prisma.sql`
      WITH ${visibleCte}
      SELECT e.id, e.snapshot_lifecycle AS "snapshotLifecycle",
        e.successor_id IS NOT NULL AS "isSuperseded", e.successor_id AS "successorId"
      FROM visible e
      WHERE ${statePredicate(state, snapshotAt)} ${seekPredicate}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit + 1}
    `;
}

/** The live gate imports this built API artifact: it cannot handcraft a companion query. */
export function buildRepresentativeProposalListPlanStatement(
  projectId: string,
  snapshotAt: Date,
  limit = 50,
): Prisma.Sql {
  return buildProposalListPageStatement({
    visibleCte: buildVisibleProposalsCte({
      projectId,
      snapshotAt,
      targetPredicate: Prisma.empty,
      generatorPredicate: Prisma.empty,
      degradedPredicate: Prisma.empty,
    }),
    state: "current",
    snapshotAt,
    seekPredicate: Prisma.empty,
    limit,
  });
}

export async function listTriageProposals(
  userId: string,
  projectId: string,
  query: ListTriageProposalsQuery = {},
  allowedProjectIds: readonly string[] | undefined = undefined,
  correlationId: string = randomUUID(),
) {
  const requestedAt = new Date();
  const state = query.state ?? "current";
  const limit = query.limit ?? 20;
  if (limit < 1 || limit > 50) {
    throw new AppError(400, "INVALID_LIMIT", "Proposal list limit must be from 1 through 50");
  }
  if (query.targetIssueKey && query.targetIssueId) {
    throw new AppError(400, "INVALID_TARGET_FILTER", "Use one target issue filter");
  }

  try {
    return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', '1400ms', true)`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true, archived: true },
    });
    if (project?.archived || !project || (allowedProjectIds?.length && !allowedProjectIds.includes(project.id))) {
      throw new AppError(404, "NOT_FOUND", "Project not found");
    }

    const [member, projectMember] = await Promise.all([
      tx.member.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
        select: { role: true, projectAccess: true },
      }),
      tx.projectMember.findUnique({
        where: { userId_projectId: { userId, projectId: project.id } },
        select: { role: true },
      }),
    ]);
    if (
      !member ||
      (member.role !== "owner" &&
        member.role !== "admin" &&
        member.projectAccess !== "workspace" &&
        !projectMember)
    ) {
      throw new AppError(404, "NOT_FOUND", "Project not found");
    }

    let targetIssueId = query.targetIssueId;
    if (query.targetIssueKey || targetIssueId) {
      const target = await tx.issue.findFirst({
        where: {
          projectId: project.id,
          ...(query.targetIssueKey ? { key: query.targetIssueKey } : { id: targetIssueId }),
        },
        select: { id: true },
      });
      if (!target) throw new AppError(404, "NOT_FOUND", "Target issue not found");
      targetIssueId = target.id;
    }

    const authorizationContext = sha256Hex(canonicalJsonBytes({
      role: member.role,
      projectAccess: member.projectAccess,
      projectRole: projectMember?.role ?? null,
      allowedProjectIds: allowedProjectIds?.length ? [...allowedProjectIds].sort() : null,
    }, { setFields: ["allowedProjectIds"] }));
    const cursorBinding: CursorBinding = {
      version: 1,
      projectId: project.id,
      userId,
      state,
      targetIssueKey: query.targetIssueKey ?? null,
      targetIssueId: targetIssueId ?? null,
      generatorSource: query.generatorSource ?? null,
      degraded: query.degraded ?? null,
      authorizationContext,
      authorizationPolicyVersion: AUTHORIZATION_POLICY_VERSION,
    };
    const cursor = query.cursor ? parseCursor(query.cursor, cursorBinding) : null;
    const snapshotAt = cursor ? new Date(cursor.snapshotAt) : requestedAt;

    const targetPredicate = targetIssueId
      ? Prisma.sql`AND tp.target_issue_id = ${targetIssueId}::uuid`
      : Prisma.empty;
    const generatorPredicate = query.generatorSource
      ? Prisma.sql`AND tp.list_summary->>'generatorSource' = ${query.generatorSource}`
      : Prisma.empty;
    const degradedPredicate = query.degraded === undefined
      ? Prisma.empty
      : Prisma.sql`AND (tp.list_summary->>'degraded')::boolean = ${query.degraded}`;
    const visibleCte = buildVisibleProposalsCte({
      projectId: project.id,
      snapshotAt,
      targetPredicate,
      generatorPredicate,
      degradedPredicate,
    });

    const [source] = await tx.$queryRaw<[{ sourceFingerprint: string }]>(Prisma.sql`
      WITH ${visibleCte}
      SELECT md5(COALESCE(string_agg(
        concat_ws(':', e.id::text, e.created_at::text, e.snapshot_lifecycle,
          e.expires_at::text, (e.successor_id IS NOT NULL)::text, e.target_issue_id::text,
          e.project_id::text, COALESCE(e.disposition_list_visible::text, '')),
        ',' ORDER BY e.created_at DESC, e.id DESC
      ), 'empty')) AS "sourceFingerprint"
      FROM visible e
      WHERE ${statePredicate(state, snapshotAt)}
    `);
    const sourceFingerprint = source?.sourceFingerprint ?? "";
    if (cursor && cursor.sourceFingerprint !== sourceFingerprint) {
      throw new AppError(409, "CURSOR_SOURCE_CONFLICT", "Proposal list changed; restart listing");
    }

    const seekPredicate = cursor
      ? Prisma.sql`AND (e.created_at < ${new Date(cursor.lastCreatedAt)} OR (e.created_at = ${new Date(cursor.lastCreatedAt)} AND e.id < ${cursor.lastId}::uuid))`
      : Prisma.empty;
    const pageIds = await tx.$queryRaw<Array<{
      id: string;
      snapshotLifecycle: string;
      isSuperseded: boolean;
      successorId: string | null;
    }>>(buildProposalListPageStatement({ visibleCte, state, snapshotAt, seekPredicate, limit }));
    const hasMore = pageIds.length > limit;
    const page = pageIds.slice(0, limit);
    const proposals = await tx.triageProposal.findMany({
      where: { id: { in: page.map(({ id }) => id) } },
      select: {
        id: true,
        listSummary: true,
        createdAt: true,
        expiresAt: true,
        disposedAt: true,
        dispositionListVisible: true,
        targetIssueId: true,
        capturedPolicyVersion: true,
        capturedRetentionDays: true,
        policyId: true,
        supersedesId: true,
      },
    });
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    const relatedIds = [...new Set([
      ...page.flatMap(({ successorId }) => successorId ? [successorId] : []),
      ...proposals.flatMap(({ supersedesId }) => supersedesId ? [supersedesId] : []),
    ])];
    const visibleRelatedIds = new Set((await tx.triageProposal.findMany({
      where: {
        id: { in: relatedIds },
        OR: [{ lifecycle: { not: "disposed" }, disposedAt: null }, { dispositionListVisible: true }],
      },
      select: { id: true },
    })).map(({ id }) => id));
    const rows = page.flatMap<{ id: string; [key: string]: unknown }>(
      ({ id, snapshotLifecycle, isSuperseded, successorId }) => {
      const proposal = byId.get(id);
      if (!proposal) return [];
      const lifecycle = effectiveState(
        snapshotLifecycle,
        proposal.expiresAt,
        snapshotAt,
        isSuperseded,
      );
      if (lifecycle === "disposed") {
        return [{
          id,
          kind: "issue_triage_v1" as const,
          contractVersion: "triage-proposal.v1" as const,
          lifecycle,
          current: false,
          disposedAt: proposal.disposedAt,
          createdAt: proposal.createdAt,
          targetIssueId: proposal.targetIssueId,
          dispositionListVisible: true,
          retentionPolicy: {
            id: proposal.policyId,
            version: proposal.capturedPolicyVersion,
            retentionDays: proposal.capturedRetentionDays,
          },
        }];
      }
      return [{
        id,
        kind: "issue_triage_v1" as const,
        contractVersion: "triage-proposal.v1" as const,
        lifecycle,
        current: lifecycle === "current",
        listSummary: compactSummary(proposal.listSummary),
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        targetIssueId: proposal.targetIssueId,
        supersedesId: proposal.supersedesId && visibleRelatedIds.has(proposal.supersedesId)
          ? proposal.supersedesId
          : null,
        successorId: successorId && visibleRelatedIds.has(successorId) ? successorId : null,
      }];
      },
    );
     const buildResponse = () => {
       const lastRow = rows.at(-1);
       const lastProposal = lastRow ? byId.get(lastRow.id) : null;
       return {
        contractVersion: TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION,
        orderingVersion: TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION,
        projection: "compact" as const,
        effectiveScope: { kind: "project" as const, workspaceId: project.workspaceId, projectId: project.id },
        correlationId,
         returnedCount: rows.length,
         rows,
         snapshotAt,
         ...(hasMore && lastProposal
          ? {
              nextCursor: encodeProposalListCursor({
                ...cursorBinding,
                sourceFingerprint,
                snapshotAt: snapshotAt.toISOString(),
                lastCreatedAt: lastProposal.createdAt.toISOString(),
                lastId: lastProposal.id,
              }, env.JWT_SECRET),
            }
          : {}),
      };
     };
     const response = buildResponse();
     if (Buffer.byteLength(JSON.stringify(response)) > 32 * 1024) {
       throw new AppError(503, "LIST_OUTPUT_BUDGET_EXCEEDED", "Proposal list output exceeds its fixed budget");
     }
    return response;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 250,
      timeout: 2000,
    });
  } catch (error) {
    if (isListTimeout(error)) {
      throw new AppError(503, "LIST_TIMED_OUT", "Proposal list deadline exceeded");
    }
    throw error;
  }
}
