import type { IssuePriority, IssueState } from "@prisma/client";

export const CANONICAL_ENTITY_TYPES = [
  "project",
  "cycle",
  "issue",
  "comment",
  "time_entry",
  "user",
] as const;
export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

export const REMOTE_ENTITY_TYPES = ["issue", "comment"] as const;
export type RemoteEntityType = (typeof REMOTE_ENTITY_TYPES)[number];

export const CANONICAL_CHANGE_OPERATIONS = ["create", "update", "delete", "close"] as const;
export type CanonicalChangeOperation = (typeof CANONICAL_CHANGE_OPERATIONS)[number];

export const FIELD_VALUE_KINDS = ["omit", "set", "clear"] as const;
export type FieldValueKind = (typeof FIELD_VALUE_KINDS)[number];

export type SettableFieldValue<T> =
  | { readonly kind: "omit" }
  | { readonly kind: "set"; readonly value: T };
export type FieldValue<T> = SettableFieldValue<T> | { readonly kind: "clear"; readonly value: null };
export type CanonicalIssueState = IssueState;

export interface CanonicalUser {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string | null;
}

export interface CanonicalProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
}

export interface CanonicalCycle {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

export interface CanonicalIssue {
  readonly id: string;
  readonly key: string;
  readonly projectId: string;
  readonly cycleId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: CanonicalIssueState;
  readonly priority: IssuePriority;
  readonly assignee: CanonicalUser | null;
  readonly estimateHours: number | null;
  readonly startDate: Date | null;
  readonly dueDate: Date | null;
  readonly progress: number;
}

export interface CanonicalIssuePatch {
  readonly title: SettableFieldValue<string>;
  readonly description: FieldValue<string>;
  readonly status: SettableFieldValue<CanonicalIssueState>;
  readonly priority: SettableFieldValue<IssuePriority>;
  readonly assignee: FieldValue<CanonicalUser>;
  readonly estimateHours: FieldValue<number>;
  readonly startDate: FieldValue<Date>;
  readonly dueDate: FieldValue<Date>;
  readonly progress: SettableFieldValue<number>;
  readonly cycleId: FieldValue<string>;
}

export interface CanonicalComment {
  readonly id: string;
  readonly issueId: string;
  readonly body: string;
  readonly author: CanonicalUser;
  readonly createdAt: Date;
}

export interface CanonicalTimeEntry {
  readonly id: string;
  readonly issueId: string;
  readonly hours: string;
  readonly workedOn: Date;
}

export type StatusReadMap = Readonly<Record<string, CanonicalIssueState>>;
export type StatusWriteMap = Readonly<Partial<Record<CanonicalIssueState, string>>>;
export const TIME_ENTRY_ACTIVITY_MAP_KEY = "_timeEntryActivityId";
export interface StatusMaps {
  readonly read: StatusReadMap;
  readonly write: StatusWriteMap;
}

export interface DiscoveredProject {
  readonly id: string;
  readonly name: string;
}
export interface DiscoveredStatus {
  readonly id: string;
  readonly name: string;
  readonly writable: boolean;
}
export interface DiscoveredPriority {
  readonly id: string;
  readonly name: string;
}
export interface DiscoveredCycle {
  readonly id: string;
  readonly name: string;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}
export interface DiscoveredUser {
  readonly id: string;
  readonly displayName: string;
  readonly login?: string | null;
}
export interface DiscoveredTimeEntryActivity {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface PmProviderCapabilities {
  readonly canCreateProjects: boolean;
  readonly canCreateCycles: boolean;
  readonly canCreateIssues: boolean;
  readonly canReadIssues: boolean;
  readonly canUpdateIssues: boolean;
  readonly canReadPublicComments: boolean;
  readonly canCreatePublicComments: boolean;
  readonly canMutateComments: boolean;
  readonly hasDeletionSignals: boolean;
  readonly hasWebhooks: boolean;
}
export interface PushResult {
  readonly externalId: string;
  readonly requestedStatusId: string | null;
  readonly achievedStatusId: string | null;
  readonly remoteVersion: string | null;
  readonly deleted?: boolean;
  readonly remoteIssueId?: string;
  readonly marker?: string;
  readonly strippedBodySha256?: string;
  readonly remoteActorId?: string;
}

export type ProviderCreateReconciliationRequest =
  | {
      readonly entityType: "issue" | "cycle";
      readonly entityId: string;
      readonly remoteProjectId: string;
    }
  | {
      readonly entityType: "time_entry";
      readonly entityId: string;
      readonly remoteProjectId: string;
      readonly remoteIssueId: string;
      readonly spentOn: string;
    }
  | {
      readonly entityType: "comment";
      readonly entityId: string;
      readonly expectedRemoteIssueId: string;
      readonly marker: string;
      readonly strippedBodySha256: string;
      readonly expectedCredentialRemoteUserId: string;
    };

export interface ProviderCreateReconciler {
  reconcileCreate(
    request: ProviderCreateReconciliationRequest,
  ): Promise<readonly PushResult[]>;
}

export type ProviderDispatchOutcome = "retry" | "ambiguous";

export class ProviderDispatchError extends Error {
  constructor(
    readonly outcome: ProviderDispatchOutcome,
    cause: unknown,
  ) {
    super(`Provider dispatch outcome is ${outcome}`, { cause });
    this.name = "ProviderDispatchError";
  }
}

const RETRYABLE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

export function isProviderAuthenticationError(error: unknown): boolean {
  const value = error instanceof ProviderDispatchError ? error.cause : error;
  return !!value && typeof value === "object" && "statusCode" in value && value.statusCode === 401;
}

export function safeErrorEvidence(error: unknown): Record<string, string | number> {
  const value = error && typeof error === "object"
    ? error as { name?: unknown; code?: unknown; statusCode?: unknown }
    : {};
  return {
    name: typeof value.name === "string" ? value.name : "UnknownError",
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.statusCode === "number" ? { statusCode: value.statusCode } : {}),
  };
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderDispatchError) return error.outcome === "retry";
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    statusCode?: unknown;
  };
  if (typeof value.statusCode === "number") {
    return value.statusCode === 429 || (value.statusCode >= 500 && value.statusCode <= 599);
  }
  return (
    (typeof value.code === "string" &&
      (RETRYABLE_NETWORK_CODES.has(value.code) || value.code.startsWith("UND_ERR_"))) ||
    value.name === "AbortError" ||
    value.name === "TimeoutError" ||
    (typeof value.message === "string" &&
      /abort|fetch failed|network|socket|timed out/i.test(value.message))
  );
}

export interface PmProviderAdapter extends ProviderCreateReconciler {
  capabilities(): Promise<PmProviderCapabilities>;
  listProjects(): Promise<readonly DiscoveredProject[]>;
  listStatuses(): Promise<readonly DiscoveredStatus[]>;
  listPriorities(): Promise<readonly DiscoveredPriority[]>;
  listCycles(projectId: string): Promise<readonly DiscoveredCycle[]>;
  listTimeEntryActivities(): Promise<readonly DiscoveredTimeEntryActivity[]>;
  whoAmI(): Promise<DiscoveredUser>;
  ensureProject(project: CanonicalProject): Promise<PushResult>;
  ensureCycle(cycle: CanonicalCycle): Promise<PushResult>;
  pushIssue(issue: CanonicalIssue, patch: CanonicalIssuePatch): Promise<PushResult>;
  deleteIssue(remoteIssueId: string): Promise<PushResult>;
  pushComment(comment: CanonicalComment, remoteIssueId: string): Promise<PushResult>;
  pushTimeEntry(entry: CanonicalTimeEntry, activityId: string): Promise<PushResult>;
}

export type CanonicalEntity =
  | CanonicalProject
  | CanonicalCycle
  | CanonicalIssue
  | CanonicalComment
  | CanonicalTimeEntry
  | CanonicalUser;

type CanonicalEntityByType = {
  readonly project: CanonicalProject;
  readonly cycle: CanonicalCycle;
  readonly issue: CanonicalIssue;
  readonly comment: CanonicalComment;
  readonly time_entry: CanonicalTimeEntry;
  readonly user: CanonicalUser;
};

type CanonicalChangeMetadata = {
  readonly entityId: string;
  readonly changedAt: Date;
  readonly remoteVersion: string | null;
  readonly correlationId: string | null;
};

type CanonicalChangeWithValue<TEntityType extends CanonicalEntityType> =
  CanonicalChangeMetadata & {
    readonly entityType: TEntityType;
    readonly operation: Exclude<CanonicalChangeOperation, "delete">;
    readonly value: CanonicalEntityByType[TEntityType];
  };

type CanonicalDeleteChange<TEntityType extends CanonicalEntityType> =
  CanonicalChangeMetadata & {
    readonly entityType: TEntityType;
    readonly operation: "delete";
    readonly value: null;
  };

export type CanonicalChange = {
  [TEntityType in CanonicalEntityType]:
    | CanonicalChangeWithValue<TEntityType>
    | CanonicalDeleteChange<TEntityType>;
}[CanonicalEntityType];

export interface RemoteIdentity {
  readonly type: RemoteEntityType;
  readonly remoteId: string;
  readonly remoteProjectId: string;
  readonly parent?: {
    readonly type: RemoteEntityType;
    readonly remoteId: string;
  };
}

export interface RemoteActor {
  readonly remoteId: string;
  readonly displayName: string;
  readonly username?: string | null;
}

export interface RemoteChange<TFields = Readonly<Record<string, unknown>>> {
  readonly identity: RemoteIdentity;
  readonly operation: "upsert" | "tombstone";
  readonly changedAt: Date;
  readonly createdAt?: Date;
  readonly closedAt?: Date;
  readonly sourceVersion: string;
  readonly actor?: RemoteActor;
  readonly fields: TFields;
}

export interface PollCheckpoint {
  readonly updatedAt: Date;
  readonly remoteId: string;
  readonly pageToken?: string | null;
}

export interface PollPage<TChange = RemoteChange> {
  readonly changes: readonly TChange[];
  readonly nextCheckpoint: PollCheckpoint | null;
  readonly hasMore: boolean;
}

export interface InboundCursor {
  readonly updatedAt: Date;
  readonly entityId: string;
}
export interface InboundIssueStatusChange {
  readonly entityType: "issue";
  readonly entityId: string;
  readonly operation: "update" | "close";
  readonly changedAt: Date;
  readonly remoteVersion: string;
  readonly correlationId: null;
  readonly state: CanonicalIssueState;
}
export interface InboundPage<TChange = CanonicalChange> {
  readonly changes: readonly TChange[];
  readonly nextCursor: InboundCursor | null;
  readonly hasMore: boolean;
}
export interface InboundSource<TChange = CanonicalChange> {
  poll(cursor: InboundCursor | null): Promise<InboundPage<TChange>>;
}
