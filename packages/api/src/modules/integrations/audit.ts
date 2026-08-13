import type { AuditCheckpoint, AuditObservation, AuditRunState } from "./core/audit-evidence.js";
import type { PollCheckpoint } from "./core/types.js";
import type { DecodedRedmineIssue, RedmineIssueChange } from "./providers/redmine/decoder.js";
import type { RedmineAuditFailureCode, RedmineAuditRead } from "./providers/redmine/audit-source.js";

export interface AuditCensusLease {
  readonly bindingId: string;
  readonly leaseToken: string;
  readonly fence: number;
  readonly scopeFingerprint: string;
}

export interface AuditCensusPersistence {
  /** Must check the existing binding poll lease token/fence and exact claimed scope. */
  isLeaseCurrent(lease: AuditCensusLease): Promise<boolean>;
  /** Must atomically write observations and checkpoint behind that same poll fence. */
  commitIssue(input: {
    readonly lease: AuditCensusLease;
    readonly providerObservedAt: Date;
    readonly observations: readonly AuditObservation[];
    readonly checkpoint: AuditCheckpoint;
  }): Promise<boolean>;
  /** Must conditionally mark the run complete behind the same fence and scope predicate. */
  finish(input: { readonly lease: AuditCensusLease; readonly providerObservedAt: Date }): Promise<boolean>;
}

export interface AuditCensusSource {
  readPage(offset: number, limit: number, checkpoint: PollCheckpoint | null): Promise<RedmineAuditRead<{ readonly changes: readonly RedmineIssueChange[]; readonly nextCheckpoint: PollCheckpoint | null; readonly hasMore: boolean }>>;
  readIssueDetail(issueId: string): Promise<RedmineAuditRead<DecodedRedmineIssue> | { readonly kind: "not_visible_in_scope" }>;
}

export type AuditCensusResult =
  | { readonly kind: "complete-current-visible"; readonly scopeFingerprint: string }
  | { readonly kind: "unknown"; readonly reasonCode: RedmineAuditFailureCode | "scope_or_fence_changed" | "did_not_converge" };

export interface AuditCensusOptions {
  readonly pageSize: number;
  readonly maxPasses: number;
}

/** A durable run is complete only after its fenced census transition. */
export function isCompleteCurrentVisibleCensus(run: {
  readonly state: AuditRunState;
  readonly scopeFingerprint: string;
  readonly completedAt: Date | null;
}): boolean {
  return run.state === "complete" && run.scopeFingerprint.length > 0 && run.completedAt !== null;
}

function unknown(reasonCode: Extract<AuditCensusResult, { readonly kind: "unknown" }>["reasonCode"]): AuditCensusResult {
  return { kind: "unknown", reasonCode };
}

function normalizedObservations(detail: DecodedRedmineIssue): AuditObservation[] {
  const issue = detail.issue;
  const commentsById = new Map(detail.comments.map((comment) => [comment.identity.remoteId, comment]));
  return [
    { identityType: "issue", remoteId: issue.identity.remoteId, parentRemoteId: null, sourceUpdatedAt: issue.changedAt },
    ...detail.journalIds.map((journalId) => ({
      identityType: "comment" as const,
      remoteId: journalId,
      parentRemoteId: issue.identity.remoteId,
      sourceUpdatedAt: commentsById.get(journalId)?.changedAt ?? issue.changedAt,
    })),
  ];
}

function checkpoint(
  pass: number,
  offset: number,
  itemIndex: number,
  expectedTotal: number,
  issue: RedmineIssueChange,
): AuditCheckpoint {
  return {
    pass,
    offset,
    itemIndex,
    expectedTotal,
    lastIssueUpdatedAt: issue.changedAt,
    lastIssueId: issue.identity.remoteId,
  };
}

function fingerprint(observations: readonly AuditObservation[]): string {
  return observations
    .map((observation) => [observation.identityType, observation.parentRemoteId ?? "", observation.remoteId, observation.sourceUpdatedAt.toISOString()].join("\0"))
    .sort()
    .join("\n");
}

/**
 * Performs a bounded census only. A complete result proves convergence of records
 * currently visible to one held scope; it deliberately has no absence meaning.
 */
export async function runRedmineAuditCensus(
  source: AuditCensusSource,
  persistence: AuditCensusPersistence,
  lease: AuditCensusLease,
  options: AuditCensusOptions,
): Promise<AuditCensusResult> {
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1) throw new RangeError("pageSize must be positive");
  if (!Number.isSafeInteger(options.maxPasses) || options.maxPasses < 2) throw new RangeError("maxPasses must be at least two");

  let previousPass: string | null = null;
  let providerObservedAt: Date | null = null;
  for (let pass = 0; pass < options.maxPasses; pass += 1) {
    const passObservations: AuditObservation[] = [];
    let offset = 0;
    let expectedTotal = 0;
    let pageCheckpoint: PollCheckpoint | null = null;
    do {
      if (!(await persistence.isLeaseCurrent(lease))) return unknown("scope_or_fence_changed");
      const page = await source.readPage(offset, options.pageSize, pageCheckpoint);
      if (page.kind !== "accepted") return unknown(page.reasonCode);
      providerObservedAt ??= page.providerObservedAt;
      if (page.providerObservedAt.getTime() !== providerObservedAt.getTime()) return unknown("malformed_response");
      expectedTotal += page.value.changes.length;
      for (let itemIndex = 0; itemIndex < page.value.changes.length; itemIndex += 1) {
        if (!(await persistence.isLeaseCurrent(lease))) return unknown("scope_or_fence_changed");
        const issue = page.value.changes[itemIndex]!;
        const detail = await source.readIssueDetail(issue.identity.remoteId);
        if (detail.kind !== "accepted") return unknown(detail.kind === "unknown" ? detail.reasonCode : "detail_drift");
        if (detail.providerObservedAt.getTime() !== providerObservedAt.getTime()) return unknown("malformed_response");
        const observations = normalizedObservations(detail.value);
        const nextCheckpoint = checkpoint(pass, offset, itemIndex, expectedTotal, issue);
        if (!(await persistence.commitIssue({ lease, providerObservedAt, observations, checkpoint: nextCheckpoint }))) {
          return unknown("scope_or_fence_changed");
        }
        passObservations.push(...observations);
      }
      offset += page.value.changes.length;
      pageCheckpoint = page.value.nextCheckpoint;
      if (page.value.hasMore && page.value.changes.length === 0) return unknown("pagination_drift");
      if (!page.value.hasMore) break;
    } while (true);

    const currentPass = fingerprint(passObservations);
    if (previousPass === currentPass) {
      if (!(await persistence.isLeaseCurrent(lease)) || !(await persistence.finish({ lease, providerObservedAt: providerObservedAt! }))) {
        return unknown("scope_or_fence_changed");
      }
      return { kind: "complete-current-visible", scopeFingerprint: lease.scopeFingerprint };
    }
    previousPass = currentPass;
  }
  return unknown("did_not_converge");
}
