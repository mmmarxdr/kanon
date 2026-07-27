import { Prisma, PrismaClient } from "@prisma/client";

const SUPPORTED_ENTITY_TYPES = new Set(["issue", "project", "cycle"]);

/** Stable PostgreSQL transaction-level advisory-lock key for cooperating writers. */
export const EXTERNAL_REF_BACKFILL_LOCK_KEY = 0x4b414e4f4e5f4136n;

export type ExternalRefBackfillReason =
  | "unsupported-entity-type"
  | "local-entity-not-found"
  | "binding-not-found"
  | "ambiguous-binding"
  | "tenant-mismatch";

export interface ExternalRefBackfillDiagnostic {
  readonly externalRefId: string;
  readonly connectionId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly projectId: string | null;
  readonly reason: ExternalRefBackfillReason;
  readonly candidateBindingIds: readonly string[];
}

export interface ExternalRefBackfillSnapshot {
  /** This describes only the transaction's observed snapshot, not a concurrency proof. */
  readonly unresolvedCount: number;
  readonly zeroUnresolved: boolean;
}

export interface ExternalRefBackfillResult {
  readonly scanned: number;
  readonly updated: number;
  readonly unresolved: readonly ExternalRefBackfillDiagnostic[];
  readonly snapshot: ExternalRefBackfillSnapshot;
}

export type ExternalRefBackfillInvariantReason =
  | "unbound-reference"
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

export interface BindingCandidate {
  readonly id: string;
  readonly connectionId: string;
  readonly projectId: string;
}

interface WorkspaceOwnedBindingCandidate extends BindingCandidate {
  readonly connectionWorkspaceId: string;
  readonly projectWorkspaceId: string;
}

interface EntityOwnership {
  readonly projectId: string;
  readonly workspaceId: string;
}

type BindingResolution =
  | { readonly bindingId: string }
  | {
      readonly bindingId: null;
      readonly reason: "binding-not-found" | "ambiguous-binding";
      readonly candidateBindingIds: readonly string[];
    };

export class ExternalRefBackfillError extends Error {
  readonly result: ExternalRefBackfillResult;
  readonly diagnostics: readonly ExternalRefBackfillDiagnostic[];

  constructor(result: ExternalRefBackfillResult) {
    super(
      `External reference binding backfill left ${result.snapshot.unresolvedCount} unresolved row(s)`,
    );
    this.name = "ExternalRefBackfillError";
    this.result = result;
    this.diagnostics = result.unresolved;
  }
}

export class ExternalRefBackfillInvariantError extends Error {
  readonly violations: readonly ExternalRefBackfillInvariantViolation[];

  constructor(violations: readonly ExternalRefBackfillInvariantViolation[]) {
    super(`External reference binding invariant failed for ${violations.length} row(s)`);
    this.name = "ExternalRefBackfillInvariantError";
    this.violations = violations;
  }
}

export function resolveBindingCandidates(
  connectionId: string,
  projectId: string,
  candidates: readonly BindingCandidate[],
): BindingResolution {
  const matchingBindingIds = candidates
    .filter(
      (candidate) =>
        candidate.connectionId === connectionId && candidate.projectId === projectId,
    )
    .map((candidate) => candidate.id)
    .sort();

  if (matchingBindingIds.length === 1) {
    return { bindingId: matchingBindingIds[0]! };
  }
  if (matchingBindingIds.length > 1) {
    return {
      bindingId: null,
      reason: "ambiguous-binding",
      candidateBindingIds: matchingBindingIds,
    };
  }
  return {
    bindingId: null,
    reason: "binding-not-found",
    candidateBindingIds: [],
  };
}

async function acquireExternalRefBackfillWriteGate(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(${EXTERNAL_REF_BACKFILL_LOCK_KEY}::bigint)
    `,
  );
}

async function validateExternalRefBackfillInvariants(
  transaction: Prisma.TransactionClient,
): Promise<readonly ExternalRefBackfillInvariantViolation[]> {
  const refs = await transaction.externalRef.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      connectionId: true,
      bindingId: true,
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
    if (ref.bindingId === null) {
      violations.push({ ...base, reason: "unbound-reference" });
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

async function runWithExternalRefBackfillWriteGate<T>(
  transaction: Prisma.TransactionClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  await acquireExternalRefBackfillWriteGate(transaction);
  const result = await callback(transaction);
  await assertExternalRefBackfillInvariant(transaction);
  return result;
}

async function assertExternalRefBackfillInvariant(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const violations = await validateExternalRefBackfillInvariants(transaction);
  if (violations.length > 0) {
    throw new ExternalRefBackfillInvariantError(violations);
  }
}

/**
 * Runs a cooperating ExternalRef/binding writer in an owned transaction.
 * A1.7+ writers MUST use this gate until binding hardening makes the invariant structural.
 */
export async function withExternalRefBackfillWriteGate<T>(
  database: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return database.$transaction((transaction) =>
    runWithExternalRefBackfillWriteGate(transaction, callback),
  );
}

export async function backfillExternalRefBindings(
  database: PrismaClient,
): Promise<ExternalRefBackfillResult> {
  return withExternalRefBackfillWriteGate(database, executeExternalRefBindingBackfill);
}

async function executeExternalRefBindingBackfill(
  transaction: Prisma.TransactionClient,
): Promise<ExternalRefBackfillResult> {
  const refs = await transaction.externalRef.findMany({
    where: { bindingId: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      connectionId: true,
      connection: { select: { workspaceId: true } },
    },
  });

  const entityOwnership = await loadEntityOwnership(transaction, refs);
  const projectIds = [
    ...new Set([...entityOwnership.values()].map(({ projectId }) => projectId)),
  ];
  const connectionIds = [...new Set(refs.map((ref) => ref.connectionId))];
  const bindings = await loadBindingCandidates(transaction, connectionIds, projectIds);
  const unresolved: ExternalRefBackfillDiagnostic[] = [];
  const updates: Array<{ id: string; bindingId: string }> = [];

  for (const ref of refs) {
    const diagnosticBase = {
      externalRefId: ref.id,
      connectionId: ref.connectionId,
      entityType: ref.entityType,
      entityId: ref.entityId,
    };

    if (!SUPPORTED_ENTITY_TYPES.has(ref.entityType)) {
      unresolved.push({
        ...diagnosticBase,
        projectId: null,
        reason: "unsupported-entity-type",
        candidateBindingIds: [],
      });
      continue;
    }

    const ownership = entityOwnership.get(`${ref.entityType}:${ref.entityId}`);
    if (!ownership) {
      unresolved.push({
        ...diagnosticBase,
        projectId: null,
        reason: "local-entity-not-found",
        candidateBindingIds: [],
      });
      continue;
    }

    if (ref.connection.workspaceId !== ownership.workspaceId) {
      unresolved.push({
        ...diagnosticBase,
        projectId: ownership.projectId,
        reason: "tenant-mismatch",
        candidateBindingIds: [],
      });
      continue;
    }

    const matchingCandidates = bindings.filter(
      (candidate) =>
        candidate.connectionId === ref.connectionId &&
        candidate.projectId === ownership.projectId,
    );
    const sameWorkspaceCandidates = matchingCandidates.filter(
      (candidate) =>
        candidate.connectionWorkspaceId === ownership.workspaceId &&
        candidate.projectWorkspaceId === ownership.workspaceId,
    );

    if (
      matchingCandidates.some(
        (candidate) => !sameWorkspaceCandidates.some(({ id }) => id === candidate.id),
      ) ||
      (matchingCandidates.length > 0 && sameWorkspaceCandidates.length === 0)
    ) {
      unresolved.push({
        ...diagnosticBase,
        projectId: ownership.projectId,
        reason: "tenant-mismatch",
        candidateBindingIds: [],
      });
      continue;
    }

    const resolution = resolveBindingCandidates(
      ref.connectionId,
      ownership.projectId,
      sameWorkspaceCandidates,
    );
    if (resolution.bindingId === null) {
      unresolved.push({
        ...diagnosticBase,
        projectId: ownership.projectId,
        reason: resolution.reason,
        candidateBindingIds: resolution.candidateBindingIds,
      });
      continue;
    }
    updates.push({ id: ref.id, bindingId: resolution.bindingId });
  }

  const diagnostics = sortDiagnostics(unresolved);
  if (diagnostics.length > 0) {
    throw new ExternalRefBackfillError(
      createResult(refs.length, 0, diagnostics, diagnostics.length),
    );
  }

  for (const update of updates) {
    const changed = await transaction.externalRef.updateMany({
      where: { id: update.id, bindingId: null },
      data: { bindingId: update.bindingId },
    });
    if (changed.count !== 1) {
      throw new Error(`External reference ${update.id} changed during backfill`);
    }
  }

  const unresolvedCount = await transaction.externalRef.count({
    where: { bindingId: null },
  });
  return createResult(refs.length, updates.length, [], unresolvedCount);
}

async function loadBindingCandidates(
  transaction: Prisma.TransactionClient,
  connectionIds: readonly string[],
  projectIds: readonly string[],
): Promise<WorkspaceOwnedBindingCandidate[]> {
  if (connectionIds.length === 0 || projectIds.length === 0) {
    return [];
  }

  const bindings = await transaction.integrationProjectBinding.findMany({
    where: {
      connectionId: { in: [...connectionIds] },
      projectId: { in: [...projectIds] },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      connectionId: true,
      projectId: true,
      connection: { select: { workspaceId: true } },
      project: { select: { workspaceId: true } },
    },
  });

  return bindings.map((binding) => ({
    id: binding.id,
    connectionId: binding.connectionId,
    projectId: binding.projectId,
    connectionWorkspaceId: binding.connection.workspaceId,
    projectWorkspaceId: binding.project.workspaceId,
  }));
}

async function loadEntityOwnership(
  transaction: Prisma.TransactionClient,
  refs: readonly { entityType: string; entityId: string }[],
): Promise<Map<string, EntityOwnership>> {
  const projectIds = refs
    .filter((ref) => ref.entityType === "project")
    .map((ref) => ref.entityId);
  const issueIds = refs
    .filter((ref) => ref.entityType === "issue")
    .map((ref) => ref.entityId);
  const cycleIds = refs
    .filter((ref) => ref.entityType === "cycle")
    .map((ref) => ref.entityId);
  const [projects, issues, cycles] = await Promise.all([
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
  return ownership;
}

function sortDiagnostics(
  diagnostics: readonly ExternalRefBackfillDiagnostic[],
): readonly ExternalRefBackfillDiagnostic[] {
  return diagnostics
    .map((diagnostic) => ({
      ...diagnostic,
      candidateBindingIds: [...diagnostic.candidateBindingIds].sort(),
    }))
    .sort((left, right) => left.externalRefId.localeCompare(right.externalRefId));
}

function createResult(
  scanned: number,
  updated: number,
  unresolved: readonly ExternalRefBackfillDiagnostic[],
  unresolvedCount: number,
): ExternalRefBackfillResult {
  const snapshot = Object.freeze({
    unresolvedCount,
    zeroUnresolved: unresolvedCount === 0,
  });
  return Object.freeze({
    scanned,
    updated,
    unresolved: Object.freeze([...unresolved]),
    snapshot,
  });
}
