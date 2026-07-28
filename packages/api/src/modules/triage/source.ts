import { canonicalJsonBytes, sha256Hex } from "./canonical.js";

export interface TriageSourceSnapshot {
  readonly workspaceId?: string;
  readonly projectId: string;
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectKey: string;
  readonly title: string;
  readonly description?: string | null;
  readonly descriptionDigest?: string | null;
  readonly type: string | null;
  readonly priority: string | null;
  readonly state: string;
  readonly labels: readonly string[];
  readonly groupId?: string | null;
  readonly assigneeId?: string | null;
  readonly cycleId?: string | null;
  readonly parentId?: string | null;
  readonly issueUpdatedAt: Date | string;
  readonly projectUpdatedAt: Date | string;
}

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("source timestamps must be valid dates");
  return date.toISOString();
}

export function sourceVersion(issueUpdatedAt: Date | string, projectUpdatedAt: Date | string): string {
  const material = `${isoTimestamp(issueUpdatedAt)}.${isoTimestamp(projectUpdatedAt)}`;
  return `isv1.${Buffer.from(material, "utf8").toString("base64url")}`;
}

function canonicalSource(snapshot: TriageSourceSnapshot): Record<string, unknown> {
  const descriptionDigest = snapshot.descriptionDigest ?? sha256Hex(snapshot.description ?? "");
  return {
    workspaceId: snapshot.workspaceId ?? null,
    projectId: snapshot.projectId,
    issueId: snapshot.issueId,
    issueKey: snapshot.issueKey,
    projectKey: snapshot.projectKey,
    title: snapshot.title,
    descriptionDigest,
    type: snapshot.type,
    priority: snapshot.priority,
    state: snapshot.state,
    labels: [...new Set(snapshot.labels.map((label) => label.normalize("NFKC")))].sort(),
    groupId: snapshot.groupId ?? null,
    assigneeId: snapshot.assigneeId ?? null,
    cycleId: snapshot.cycleId ?? null,
    parentId: snapshot.parentId ?? null,
    issueUpdatedAt: isoTimestamp(snapshot.issueUpdatedAt),
    projectUpdatedAt: isoTimestamp(snapshot.projectUpdatedAt),
  };
}

export function canonicalSourceDocument(snapshot: TriageSourceSnapshot): Record<string, unknown> {
  return canonicalSource(snapshot);
}

export function sourceHash(snapshot: TriageSourceSnapshot): string {
  return sha256Hex(canonicalJsonBytes(canonicalSource(snapshot), { setFields: ["labels"] }));
}

export function createSourceIdentity(snapshot: TriageSourceSnapshot): {
  sourceVersion: string;
  sourceHash: string;
  canonicalSource: Record<string, unknown>;
} {
  return {
    sourceVersion: sourceVersion(snapshot.issueUpdatedAt, snapshot.projectUpdatedAt),
    sourceHash: sourceHash(snapshot),
    canonicalSource: canonicalSource(snapshot),
  };
}
