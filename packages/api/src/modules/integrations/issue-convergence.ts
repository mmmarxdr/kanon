import type { IssuePriority, IssueState, Prisma } from "@prisma/client";

export const PRIORITY_MAP_PREFIX = "priority:";
export const ISSUE_SYNC_FIELDS = [
  "title",
  "description",
  "state",
  "priority",
  "assigneeId",
  "startDate",
  "dueDate",
  "progress",
] as const;

export type IssueSyncField = (typeof ISSUE_SYNC_FIELDS)[number];
export type IssueSyncValue = string | number | null;
export type IssueSyncSnapshot = Readonly<Record<IssueSyncField, IssueSyncValue>>;
export type IssueSyncBaselineFields = Readonly<Partial<IssueSyncSnapshot>>;

export interface IssueSyncBaseline {
  readonly version: 1;
  readonly sourceVersion: string | null;
  readonly changedAt: string;
  readonly createdAt: string | null;
  readonly completedAt: string | null;
  readonly fields: IssueSyncBaselineFields;
}

export interface IssueFieldConflict {
  readonly reason: "missing-baseline" | "diverged" | "mapping" | "invalid";
  readonly baselinePresent: boolean;
  readonly baseline: IssueSyncValue | null;
  readonly local: IssueSyncValue;
  readonly remote: unknown;
}

const STATES = new Set<IssueState>([
  "backlog",
  "analysis",
  "todo",
  "in_progress",
  "review",
  "done",
]);
const PRIORITIES = new Set<IssuePriority>(["critical", "high", "medium", "low"]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validField(field: IssueSyncField, value: unknown): value is IssueSyncValue {
  if (["description", "assigneeId", "startDate", "dueDate"].includes(field) && value === null) {
    return true;
  }
  if (field === "progress") return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
  if (typeof value !== "string") return false;
  if (field === "title") return value.length > 0;
  if (field === "state") return STATES.has(value as IssueState);
  if (field === "priority") return PRIORITIES.has(value as IssuePriority);
  if (field === "startDate" || field === "dueDate") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  return true;
}

export function priorityReadKey(remoteId: string): string {
  return `${PRIORITY_MAP_PREFIX}${remoteId}`;
}

export function priorityWriteKey(priority: IssuePriority): string {
  return `${PRIORITY_MAP_PREFIX}${priority}`;
}

export function readIssueSyncBaseline(metadata: unknown): IssueSyncBaseline | null {
  const baseline = object(object(metadata)?.["baseline"]);
  const sourceFields = object(baseline?.["fields"]);
  if (!baseline || baseline["version"] !== 1 || !sourceFields) return null;

  const fields: Partial<Record<IssueSyncField, IssueSyncValue>> = {};
  for (const field of ISSUE_SYNC_FIELDS) {
    const value = sourceFields[field];
    if (validField(field, value)) fields[field] = value;
  }
  const changedAt = baseline["changedAt"];
  if (typeof changedAt !== "string" || Number.isNaN(Date.parse(changedAt))) return null;

  return {
    version: 1,
    sourceVersion:
      typeof baseline["sourceVersion"] === "string" || baseline["sourceVersion"] === null
        ? baseline["sourceVersion"]
        : null,
    changedAt,
    createdAt: typeof baseline["createdAt"] === "string" ? baseline["createdAt"] : null,
    completedAt: typeof baseline["completedAt"] === "string" ? baseline["completedAt"] : null,
    fields,
  };
}

export function reconcileIssueSnapshots(
  baseline: IssueSyncBaseline | null,
  local: IssueSyncSnapshot,
  remote: Readonly<Partial<IssueSyncSnapshot>>,
  mappingFailures: Readonly<Partial<Record<IssueSyncField, unknown>>> = {},
) {
  const patch: Partial<Record<IssueSyncField, IssueSyncValue>> = {};
  const nextBaseline: Partial<Record<IssueSyncField, IssueSyncValue>> = {
    ...(baseline?.fields ?? {}),
  };
  const appliedFields: IssueSyncField[] = [];
  const preservedFields: IssueSyncField[] = [];
  const convergedFields: IssueSyncField[] = [];
  const conflicts: Partial<Record<IssueSyncField, IssueFieldConflict>> = {};

  for (const field of ISSUE_SYNC_FIELDS) {
    const baselinePresent = Object.prototype.hasOwnProperty.call(baseline?.fields ?? {}, field);
    const base = baseline?.fields[field];
    const remotePresent = Object.prototype.hasOwnProperty.call(remote, field);
    const remoteValue = remote[field];
    const mappingFailure = mappingFailures[field];
    if (mappingFailure !== undefined || !remotePresent || !validField(field, remoteValue)) {
      conflicts[field] = {
        reason: mappingFailure !== undefined ? "mapping" : "invalid",
        baselinePresent,
        baseline: baselinePresent ? (base ?? null) : null,
        local: local[field],
        remote: mappingFailure ?? remoteValue ?? null,
      };
      continue;
    }
    if (local[field] === remoteValue) {
      nextBaseline[field] = remoteValue;
      convergedFields.push(field);
    } else if (!baselinePresent) {
      conflicts[field] = {
        reason: "missing-baseline",
        baselinePresent: false,
        baseline: null,
        local: local[field],
        remote: remoteValue,
      };
    } else if (remoteValue === base) {
      preservedFields.push(field);
    } else if (local[field] === base) {
      patch[field] = remoteValue;
      nextBaseline[field] = remoteValue;
      appliedFields.push(field);
    } else {
      conflicts[field] = {
        reason: "diverged",
        baselinePresent: true,
        baseline: base ?? null,
        local: local[field],
        remote: remoteValue,
      };
    }
  }

  return { patch, nextBaseline, appliedFields, preservedFields, convergedFields, conflicts };
}

export function issueSyncMetadata(
  metadata: unknown,
  input: {
    sourceVersion: string | null;
    changedAt: Date;
    createdAt?: Date | null;
    completedAt?: Date | null;
    fields: IssueSyncBaselineFields;
  },
): Prisma.InputJsonObject {
  const current = readIssueSyncBaseline(metadata);
  return {
    ...(object(metadata) ?? {}),
    remoteVersion: input.sourceVersion,
    baseline: {
      version: 1,
      sourceVersion: input.sourceVersion,
      changedAt: input.changedAt.toISOString(),
      createdAt: (input.createdAt?.toISOString() ?? current?.createdAt) || null,
      completedAt:
        input.completedAt === undefined
          ? (current?.completedAt ?? null)
          : input.completedAt?.toISOString() ?? null,
      fields: { ...input.fields },
    },
  } as Prisma.InputJsonObject;
}

export function canonicalRedmineDescription(value: string | null, issueId: string): string | null {
  if (value === null) return null;
  const text = value.replaceAll(`<!-- kanon-issue:${issueId} -->`, "").trimEnd();
  return text || null;
}
