import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const SUPPORTED_ENTITY_TYPES = new Set([
  "issue",
  "project",
  "cycle",
  "time_entry",
  "comment",
]);

/** Stable PostgreSQL transaction-level advisory-lock key for cooperating writers. */
export const EXTERNAL_REF_BACKFILL_LOCK_KEY = 0x4b414e4f4e5f4136n;

export type ExternalRefBackfillInvariantReason =
  | "unsupported-entity-type"
  | "local-entity-not-found"
  | "binding-not-found"
  | "binding-mismatch"
  | "tenant-mismatch";

export interface ExternalRefBackfillInvariantViolation {
  readonly externalRefId: string;
  readonly connectionId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly projectId: string | null;
  readonly reason: ExternalRefBackfillInvariantReason;
}

export interface ExternalRefBindingProofDiagnostic {
  readonly reason:
    | ExternalRefBackfillInvariantReason
    | "unbound-reference"
    | "duplicate-binding-remote-reference";
  readonly count: number;
}

interface EntityOwnership {
  readonly projectId: string;
  readonly workspaceId: string;
}

export class ExternalRefBackfillInvariantError extends Error {
  readonly violations: readonly ExternalRefBackfillInvariantViolation[];

  constructor(violations: readonly ExternalRefBackfillInvariantViolation[]) {
    super(`External reference binding invariant failed for ${violations.length} row(s)`);
    this.name = "ExternalRefBackfillInvariantError";
    this.violations = violations;
  }
}

export class ExternalRefBindingProofError extends Error {
  readonly diagnostics: readonly ExternalRefBindingProofDiagnostic[];

  constructor(diagnostics: readonly ExternalRefBindingProofDiagnostic[]) {
    super(`External reference binding proof failed for ${diagnostics.length} reason(s)`);
    this.name = "ExternalRefBindingProofError";
    this.diagnostics = diagnostics;
  }
}

export async function acquireExternalRefBackfillWriteGate(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(${EXTERNAL_REF_BACKFILL_LOCK_KEY}::bigint)
    `,
  );
}

export async function proveExternalRefBindings(
  database: PrismaClient,
): Promise<void> {
  return database.$transaction(
    async (transaction) => {
      await acquireExternalRefBackfillWriteGate(transaction);
      const [schema] = await transaction.$queryRaw<Array<{ exists: boolean }>>`
        SELECT
          to_regclass('external_refs') IS NOT NULL
          AND to_regclass('integration_project_bindings') IS NOT NULL AS exists
      `;
      if (schema?.exists !== true) return;
      const diagnostics = await transaction.$queryRaw<ExternalRefBindingProofDiagnostic[]>(
        Prisma.sql`
        WITH entity_ownership AS (
          SELECT 'project' AS entity_type, "id" AS entity_id, "id" AS project_id, "workspace_id"
          FROM "projects"
          UNION ALL
          SELECT 'issue', issue."id", issue."project_id", project."workspace_id"
          FROM "issues" issue
          JOIN "projects" project ON project."id" = issue."project_id"
          UNION ALL
          SELECT 'cycle', cycle."id", cycle."project_id", project."workspace_id"
          FROM "cycles" cycle
          JOIN "projects" project ON project."id" = cycle."project_id"
          UNION ALL
          SELECT 'time_entry', entry."id", issue."project_id", project."workspace_id"
          FROM "time_entries" entry
          JOIN "issues" issue ON issue."id" = entry."issue_id"
          JOIN "projects" project ON project."id" = issue."project_id"
          UNION ALL
          SELECT 'comment', comment."id", issue."project_id", project."workspace_id"
          FROM "comments" comment
          JOIN "issues" issue ON issue."id" = comment."issue_id"
          JOIN "projects" project ON project."id" = issue."project_id"
        ), violations AS (
          SELECT CASE
            WHEN ref."entity_type" NOT IN ('issue', 'project', 'cycle', 'time_entry', 'comment')
              THEN 'unsupported-entity-type'
            WHEN owner.entity_id IS NULL THEN 'local-entity-not-found'
            WHEN ref."binding_id" IS NULL THEN 'unbound-reference'
            WHEN binding."id" IS NULL THEN 'binding-not-found'
            WHEN ref_connection."workspace_id" <> owner.workspace_id
              OR binding_connection."workspace_id" <> owner.workspace_id
              OR binding_project."workspace_id" <> owner.workspace_id
              THEN 'tenant-mismatch'
            WHEN binding."connection_id" <> ref."connection_id"
              OR binding."project_id" <> owner.project_id
              THEN 'binding-mismatch'
            ELSE NULL
          END AS reason
          FROM "external_refs" ref
          JOIN "integration_connections" ref_connection
            ON ref_connection."id" = ref."connection_id"
          LEFT JOIN entity_ownership owner
            ON owner.entity_type = ref."entity_type" AND owner.entity_id = ref."entity_id"
          LEFT JOIN "integration_project_bindings" binding
            ON binding."id" = ref."binding_id"
          LEFT JOIN "integration_connections" binding_connection
            ON binding_connection."id" = binding."connection_id"
          LEFT JOIN "projects" binding_project
            ON binding_project."id" = binding."project_id"
        ), all_violations AS (
          SELECT reason FROM violations WHERE reason IS NOT NULL
          UNION ALL
          SELECT 'duplicate-binding-remote-reference'
          FROM "external_refs"
          WHERE "binding_id" IS NOT NULL
          GROUP BY "binding_id", "entity_type", "external_id"
          HAVING COUNT(*) > 1
        )
        SELECT reason, COUNT(*)::int AS count
        FROM all_violations
        GROUP BY reason
        ORDER BY reason
        `,
      );
      if (diagnostics.length > 0) throw new ExternalRefBindingProofError(diagnostics);
    },
    { timeout: 300_000 },
  );
}

async function validateExternalRefBackfillInvariants(
  transaction: Prisma.TransactionClient,
  externalRefId?: string,
): Promise<readonly ExternalRefBackfillInvariantViolation[]> {
  const refs = await transaction.externalRef.findMany({
    ...(externalRefId ? { where: { id: externalRefId } } : {}),
    orderBy: { id: "asc" },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      connectionId: true,
      connection: { select: { workspaceId: true } },
      binding: {
        select: {
          connectionId: true,
          projectId: true,
          connection: { select: { workspaceId: true } },
          project: { select: { workspaceId: true } },
        },
      },
    },
  });

  const entityOwnership = await loadEntityOwnership(transaction, refs);
  const violations: ExternalRefBackfillInvariantViolation[] = [];

  for (const ref of refs) {
    const ownership = entityOwnership.get(`${ref.entityType}:${ref.entityId}`);
    const base = {
      externalRefId: ref.id,
      connectionId: ref.connectionId,
      entityType: ref.entityType,
      entityId: ref.entityId,
      projectId: ownership?.projectId ?? null,
    };

    if (!SUPPORTED_ENTITY_TYPES.has(ref.entityType)) {
      violations.push({ ...base, reason: "unsupported-entity-type" });
      continue;
    }
    if (!ownership) {
      violations.push({ ...base, reason: "local-entity-not-found" });
      continue;
    }
    if (!ref.binding) {
      violations.push({ ...base, reason: "binding-not-found" });
      continue;
    }
    if (
      ref.connection.workspaceId !== ownership.workspaceId ||
      ref.binding.connection.workspaceId !== ownership.workspaceId ||
      ref.binding.project.workspaceId !== ownership.workspaceId
    ) {
      violations.push({ ...base, reason: "tenant-mismatch" });
      continue;
    }
    if (
      ref.binding.connectionId !== ref.connectionId ||
      ref.binding.projectId !== ownership.projectId
    ) {
      violations.push({ ...base, reason: "binding-mismatch" });
    }
  }

  return violations.sort((left, right) =>
    left.externalRefId.localeCompare(right.externalRefId),
  );
}

async function assertExternalRefBackfillInvariant(
  transaction: Prisma.TransactionClient,
  externalRefId?: string,
): Promise<void> {
  const violations = await validateExternalRefBackfillInvariants(transaction, externalRefId);
  if (violations.length > 0) throw new ExternalRefBackfillInvariantError(violations);
}

/** Runs a cooperating ExternalRef/binding writer in an owned transaction. */
export async function withExternalRefBackfillWriteGate<T>(
  database: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return database.$transaction(async (transaction) => {
    await acquireExternalRefBackfillWriteGate(transaction);
    const result = await callback(transaction);
    await assertExternalRefBackfillInvariant(transaction);
    return result;
  });
}

/** Runs a pre-locked worker ref write and validates only the touched reference. */
export async function withTargetedExternalRefBackfillWriteGate(
  transaction: Prisma.TransactionClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<string | null>,
): Promise<void> {
  await acquireExternalRefBackfillWriteGate(transaction);
  const externalRefId = await callback(transaction);
  if (externalRefId === null) return;
  if ((await transaction.externalRef.count({ where: { id: externalRefId } })) !== 1) {
    throw new Error(`Targeted external reference ${externalRefId} does not exist`);
  }
  await assertExternalRefBackfillInvariant(transaction, externalRefId);
}

async function loadEntityOwnership(
  transaction: Prisma.TransactionClient,
  refs: readonly { entityType: string; entityId: string }[],
): Promise<Map<string, EntityOwnership>> {
  const projectIds = refs
    .filter((ref) => ref.entityType === "project")
    .map((ref) => ref.entityId);
  const issueIds = refs.filter((ref) => ref.entityType === "issue").map((ref) => ref.entityId);
  const cycleIds = refs.filter((ref) => ref.entityType === "cycle").map((ref) => ref.entityId);
  const timeEntryIds = refs
    .filter((ref) => ref.entityType === "time_entry")
    .map((ref) => ref.entityId);
  const commentIds = refs
    .filter((ref) => ref.entityType === "comment")
    .map((ref) => ref.entityId);
  const [projects, issues, cycles, timeEntries, comments] = await Promise.all([
    transaction.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, workspaceId: true },
    }),
    transaction.issue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    }),
    transaction.cycle.findMany({
      where: { id: { in: cycleIds } },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    }),
    transaction.timeEntry.findMany({
      where: { id: { in: timeEntryIds } },
      select: {
        id: true,
        issue: { select: { projectId: true, project: { select: { workspaceId: true } } } },
      },
    }),
    transaction.comment.findMany({
      where: { id: { in: commentIds } },
      select: {
        id: true,
        issue: { select: { projectId: true, project: { select: { workspaceId: true } } } },
      },
    }),
  ]);

  const ownership = new Map<string, EntityOwnership>();
  for (const project of projects) {
    ownership.set(`project:${project.id}`, {
      projectId: project.id,
      workspaceId: project.workspaceId,
    });
  }
  for (const issue of issues) {
    ownership.set(`issue:${issue.id}`, {
      projectId: issue.projectId,
      workspaceId: issue.project.workspaceId,
    });
  }
  for (const cycle of cycles) {
    ownership.set(`cycle:${cycle.id}`, {
      projectId: cycle.projectId,
      workspaceId: cycle.project.workspaceId,
    });
  }
  for (const entry of timeEntries) {
    if (!entry.issue) continue;
    ownership.set(`time_entry:${entry.id}`, {
      projectId: entry.issue.projectId,
      workspaceId: entry.issue.project.workspaceId,
    });
  }
  for (const comment of comments) {
    ownership.set(`comment:${comment.id}`, {
      projectId: comment.issue.projectId,
      workspaceId: comment.issue.project.workspaceId,
    });
  }
  return ownership;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = new PrismaClient();
  void proveExternalRefBindings(database)
    .then(() => console.log(JSON.stringify({ zeroUnresolved: true })))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "ExternalRef binding proof failed");
      if (error instanceof ExternalRefBindingProofError) {
        console.error(JSON.stringify({ diagnostics: error.diagnostics }));
      }
      process.exitCode = 1;
    })
    .finally(() =>
      database.$disconnect().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Prisma disconnect failed");
        process.exitCode = 1;
      }),
    );
}
