import { createHash } from "node:crypto";
import type { PollCheckpoint } from "./types.js";

export const AUDIT_RUN_STATES = ["complete", "partial", "failed", "stale"] as const;
export type AuditRunState = (typeof AUDIT_RUN_STATES)[number];
export const TERMINAL_AUDIT_EVIDENCE_STATES = ["visible", "not_visible_in_scope", "unknown"] as const;
export type TerminalAuditEvidenceState = (typeof TERMINAL_AUDIT_EVIDENCE_STATES)[number];

export interface AuditScope {
  readonly bindingId: string;
  readonly connectionId: string;
  readonly normalizedBaseUrl: string;
  readonly remoteProjectId: string;
  readonly credentialId: string;
  readonly credentialFingerprint: string;
}

export interface AuditCheckpoint {
  readonly pass: number;
  readonly offset: number;
  readonly itemIndex: number;
  readonly expectedTotal: number;
  readonly lastIssueUpdatedAt: Date | null;
  readonly lastIssueId: string | null;
  /** Exact continuation used to decode the current page after a durable restart. */
  /** Undefined represents an unversioned migrated legacy row. */
  readonly checkpointVersion?: 1;
  readonly pageCheckpoint?: PollCheckpoint | null;
  readonly previousPassFingerprint?: string | null;
  readonly passComplete?: boolean;
}

export interface AuditObservation {
  readonly identityType: "issue" | "comment";
  readonly remoteId: string;
  readonly parentRemoteId: string | null;
  readonly sourceUpdatedAt: Date;
}

/** Narrow, provider-content-free trust record used by terminal readers. */
export interface TerminalAuditTrust {
  readonly state: AuditRunState;
  readonly completedAt: Date | null;
  readonly validUntil: Date | null;
  readonly scopeFingerprint: string;
}

export interface TerminalAuditTrustRead {
  readonly trust: TerminalAuditTrust | null;
  readonly databaseNow: Date;
}

/** Completion is evidence only while it is fresh and matches the held scope. */
export function isCurrentTerminalAuditEvidence(
  evidence: TerminalAuditTrust | null,
  heldScopeFingerprint: string,
  now: Date,
): boolean {
  return evidence?.state === "complete" &&
    evidence.completedAt !== null &&
    evidence.validUntil !== null &&
    evidence.validUntil.getTime() > now.getTime() &&
    evidence.scopeFingerprint === heldScopeFingerprint;
}

export function createAuditScopeFingerprint(scope: AuditScope): string {
  return createHash("sha256")
    .update(JSON.stringify([scope.bindingId, scope.connectionId, scope.normalizedBaseUrl, scope.remoteProjectId, scope.credentialId, scope.credentialFingerprint]))
    .digest("hex");
}

export function buildAuditPersistencePlan(input: {
  readonly runId: string;
  readonly scopeFingerprint: string;
  readonly fence: number;
  readonly checkpoint: AuditCheckpoint;
  readonly observations: readonly AuditObservation[];
}) {
  const observations = [...new Map(input.observations.map((observation) => [
    [observation.identityType, observation.parentRemoteId ?? "", observation.remoteId, observation.sourceUpdatedAt.toISOString()].join("\0"),
    observation,
  ])).values()];
  return { ...input, observations };
}

export function shouldRetainAuditObservation(
  observation: { readonly runState: AuditRunState; readonly completedAt: Date | null; readonly isLatestTrustworthy: boolean; readonly observedAt: Date },
  now: Date,
  retentionDays: number,
): boolean {
  const isActiveRun = observation.runState === "partial" && observation.completedAt === null;
  return isActiveRun || observation.isLatestTrustworthy ||
    observation.observedAt.getTime() >= now.getTime() - retentionDays * 86_400_000;
}
