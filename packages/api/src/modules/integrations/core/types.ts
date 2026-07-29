import type { IssueState } from "@prisma/client";

export const CANONICAL_ENTITY_TYPES = ["project", "cycle", "issue", "user"] as const;
export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

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
  readonly assignee: FieldValue<CanonicalUser>;
  readonly estimateHours: FieldValue<number>;
  readonly startDate: FieldValue<Date>;
  readonly dueDate: FieldValue<Date>;
  readonly progress: SettableFieldValue<number>;
  readonly cycleId: FieldValue<string>;
}

export type StatusReadMap = Readonly<Record<string, CanonicalIssueState>>;
export type StatusWriteMap = Readonly<Partial<Record<CanonicalIssueState, string>>>;
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

export interface PmProviderCapabilities {
  readonly canCreateProjects: boolean;
  readonly canCreateCycles: boolean;
  readonly canCreateIssues: boolean;
}
export interface PushResult {
  readonly externalId: string;
  readonly requestedStatusId: string | null;
  readonly achievedStatusId: string | null;
  readonly remoteVersion: string | null;
}

export interface PmProviderAdapter {
  capabilities(): Promise<PmProviderCapabilities>;
  listProjects(): Promise<readonly DiscoveredProject[]>;
  listStatuses(): Promise<readonly DiscoveredStatus[]>;
  listCycles(projectId: string): Promise<readonly DiscoveredCycle[]>;
  whoAmI(): Promise<DiscoveredUser>;
  ensureProject(project: CanonicalProject): Promise<PushResult>;
  ensureCycle(cycle: CanonicalCycle): Promise<PushResult>;
  pushIssue(issue: CanonicalIssue, patch: CanonicalIssuePatch): Promise<PushResult>;
}

export type CanonicalEntity =
  | CanonicalProject
  | CanonicalCycle
  | CanonicalIssue
  | CanonicalUser;

type CanonicalEntityByType = {
  readonly project: CanonicalProject;
  readonly cycle: CanonicalCycle;
  readonly issue: CanonicalIssue;
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

export interface InboundCursor {
  readonly updatedAt: Date;
  readonly entityId: string;
}
export interface InboundPage {
  readonly changes: readonly CanonicalChange[];
  readonly nextCursor: InboundCursor | null;
  readonly hasMore: boolean;
}
export interface InboundSource {
  poll(cursor: InboundCursor | null): Promise<InboundPage>;
}
