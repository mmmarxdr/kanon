import { createHash } from "node:crypto";
import { isCurrentTerminalAuditEvidence, type AuditCheckpoint, type AuditObservation, type AuditRunState, type TerminalAuditTrustRead } from "./core/audit-evidence.js";
import type { PollCheckpoint } from "./core/types.js";
import type { DecodedRedmineIssue, RedmineIssueChange } from "./providers/redmine/decoder.js";
import type { RedmineAuditFailureCode, RedmineAuditIdentityRead, RedmineAuditRead, RedmineAuditSource } from "./providers/redmine/audit-source.js";

export interface AuditCensusLease {
  readonly bindingId: string;
  readonly leaseToken: string;
  readonly fence: number;
  readonly scopeFingerprint: string;
}

export interface AuditCensusPersistence {
  /** Loads the partial run under the held lease so a restart can retain its checkpoint and observation time. */
  loadRun?(lease: AuditCensusLease): Promise<{ readonly checkpoint: AuditCheckpoint | null; readonly providerObservedAt: Date | null; readonly observations: readonly AuditObservation[] } | null>;
  /** Must check the existing binding poll lease token/fence and exact claimed scope. */
  isLeaseCurrent(lease: AuditCensusLease): Promise<boolean>;
  /** Must atomically write observations and checkpoint behind that same poll fence. */
  commitIssue(input: {
    readonly lease: AuditCensusLease;
    readonly providerObservedAt: Date;
    readonly observations: readonly AuditObservation[];
    readonly checkpoint: AuditCheckpoint;
    /** Replace prior-pass evidence only as the converged pass is committed. */
    readonly replace?: boolean;
  }): Promise<boolean>;
  /** Must conditionally mark the run complete behind the same fence and scope predicate. */
  finish(input: { readonly lease: AuditCensusLease; readonly providerObservedAt: Date }): Promise<boolean>;
}

export interface AuditCensusSource {
  readPage(offset: number, limit: number, checkpoint: PollCheckpoint | null, signal?: AbortSignal): Promise<RedmineAuditRead<{ readonly changes: readonly RedmineIssueChange[]; readonly nextCheckpoint: PollCheckpoint | null; readonly hasMore: boolean }>>;
  readIssueDetail(issueId: string, signal?: AbortSignal): Promise<RedmineAuditRead<DecodedRedmineIssue> | { readonly kind: "not_visible_in_scope" }>;
}

export type AuditCensusResult =
  | { readonly kind: "complete-current-visible"; readonly scopeFingerprint: string }
  | { readonly kind: "unknown"; readonly reasonCode: RedmineAuditFailureCode | "scope_or_fence_changed" | "did_not_converge" };

const MAX_AUDIT_OBSERVATIONS_PER_RUN = 100_000;

export interface AuditCensusOptions {
  readonly pageSize: number;
  readonly maxPasses: number;
  /** Cancels provider I/O through the audit source; cancellation never commits or finalizes evidence. */
  readonly signal?: AbortSignal;
}

export type AuditTerminalIdentity =
  | { readonly kind: "issue"; readonly issueId: string }
  | { readonly kind: "comment"; readonly issueId: string; readonly journalId: string };

export type AuditTerminalResult = { readonly kind: "visible" | "not_visible_in_scope" | "unknown" };

/** The repository rechecks the held binding poll fence and exact scope on every read. */
export interface AuditTerminalPersistence {
  readTerminalTrust(lease: AuditCensusLease): Promise<TerminalAuditTrustRead | null>;
}

/** Kept identity-only so consumers cannot receive provider content or credentials. */
export interface AuditTerminalSource {
  readIssue(issueId: string): Promise<RedmineAuditIdentityRead>;
  readComment(issueId: string, journalId: string): Promise<RedmineAuditIdentityRead>;
}

export interface HeldTerminalTrustRepository {
  terminalPersistence(lease: AuditCensusLease): AuditTerminalPersistence;
}

/** A durable run is complete only after its fenced census transition. */
export function isCompleteCurrentVisibleCensus(run: {
  readonly state: AuditRunState;
  readonly scopeFingerprint: string;
  readonly completedAt: Date | null;
}): boolean {
  return run.state === "complete" && run.scopeFingerprint.length > 0 && run.completedAt !== null;
}

function terminalResult(read: RedmineAuditIdentityRead): AuditTerminalResult {
  return read.kind === "visible" || read.kind === "not_visible_in_scope"
    ? { kind: read.kind }
    : { kind: "unknown" };
}

/**
 * Directly reads one identity through the already-held Redmine client. It never
 * turns a converged census, missing record, or missing journal into absence.
 */
export async function verifyCurrentVisibleIdentity(
  source: AuditTerminalSource,
  persistence: AuditTerminalPersistence,
  lease: AuditCensusLease,
  identity: AuditTerminalIdentity,
): Promise<AuditTerminalResult> {
  const before = await persistence.readTerminalTrust(lease);
  if (!before || !isCurrentTerminalAuditEvidence(before.trust, lease.scopeFingerprint, before.databaseNow)) return { kind: "unknown" };
  const read = identity.kind === "issue"
    ? await source.readIssue(identity.issueId)
    : await source.readComment(identity.issueId, identity.journalId);
  const after = await persistence.readTerminalTrust(lease);
  return after && isCurrentTerminalAuditEvidence(after.trust, lease.scopeFingerprint, after.databaseNow)
    ? terminalResult(read)
    : { kind: "unknown" };
}

/**
 * Module-level admission check for an absence candidate.  It deliberately
 * returns only a boolean: raw provider failures and identity details cannot
 * escape this boundary or be mistaken for containment authority.
 */
export async function verifyTerminalAbsenceProof(
  source: AuditTerminalSource,
  persistence: AuditTerminalPersistence,
  lease: AuditCensusLease,
  identity: AuditTerminalIdentity,
): Promise<boolean> {
  return (await verifyCurrentVisibleIdentity(source, persistence, lease, identity)).kind === "not_visible_in_scope";
}

/** Production seam: one held Redmine source, durable lease, and repository trust reader. */
export function createHeldTerminalTrustVerifier(input: {
  readonly source: RedmineAuditSource;
  readonly repository: HeldTerminalTrustRepository;
  readonly lease: AuditCensusLease;
}): (identity: AuditTerminalIdentity) => Promise<AuditTerminalResult> {
  const persistence = input.repository.terminalPersistence(input.lease);
  return (identity) => verifyCurrentVisibleIdentity(input.source, persistence, input.lease, identity);
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
  issue?: RedmineIssueChange,
  pageCheckpoint: PollCheckpoint | null = null,
  previousPassFingerprint: string | null = null,
  passComplete = false,
): AuditCheckpoint {
  return {
    pass,
    offset,
    itemIndex,
    expectedTotal,
    lastIssueUpdatedAt: issue?.changedAt ?? null,
    lastIssueId: issue?.identity.remoteId ?? null,
    checkpointVersion: 1,
    pageCheckpoint,
    previousPassFingerprint,
    passComplete,
  };
}

function observationFingerprint(observation: AuditObservation): string {
  return [observation.identityType, observation.parentRemoteId ?? "", observation.remoteId, observation.sourceUpdatedAt.toISOString()].join("\0");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(observations: readonly AuditObservation[]): string {
  return digest([...new Set(observations.map(observationFingerprint))].sort().join("\n"));
}

function normalizedFingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-f0-9]{64}$/.test(value) ? value : digest(value);
}

function resumableCheckpoint(checkpoint: AuditCheckpoint | null, observations: readonly AuditObservation[]): AuditCheckpoint | null {
  if (checkpoint?.checkpointVersion !== 1 || checkpoint.passComplete || checkpoint.itemIndex < 0) return null;
  if (checkpoint.offset > 0 && !checkpoint.pageCheckpoint?.pageToken) return null;
  const issues = observations.filter((observation) => observation.identityType === "issue");
  const committedIssueCount = checkpoint.offset + checkpoint.itemIndex + 1;
  const last = issues.find((observation) => observation.remoteId === checkpoint.lastIssueId &&
    observation.sourceUpdatedAt.getTime() === checkpoint.lastIssueUpdatedAt?.getTime());
  return issues.length === committedIssueCount && last ? checkpoint : null;
}

function matchesResumedPrefix(
  checkpoint: AuditCheckpoint,
  changes: readonly RedmineIssueChange[],
  observations: readonly AuditObservation[],
): boolean {
  if (checkpoint.expectedTotal !== checkpoint.offset + changes.length || changes.length <= checkpoint.itemIndex) return false;
  const persistedPrefix = observations
    .filter((observation) => observation.identityType === "issue")
    .sort((left, right) => left.sourceUpdatedAt.getTime() - right.sourceUpdatedAt.getTime() || Number(left.remoteId) - Number(right.remoteId))
    .slice(checkpoint.offset, checkpoint.offset + checkpoint.itemIndex + 1)
    .map(observationFingerprint);
  const replayedPrefix = changes.slice(0, checkpoint.itemIndex + 1);
  const last = replayedPrefix.at(-1);
  return replayedPrefix.length === persistedPrefix.length && replayedPrefix.every((issue, index) => observationFingerprint({
    identityType: "issue", remoteId: issue.identity.remoteId, parentRemoteId: null, sourceUpdatedAt: issue.changedAt,
  }) === persistedPrefix[index]) && last?.identity.remoteId === checkpoint.lastIssueId &&
    last.changedAt.getTime() === checkpoint.lastIssueUpdatedAt?.getTime();
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
  if (options.signal?.aborted) return unknown("timeout");

  const resumedRun = await persistence.loadRun?.(lease);
  if (resumedRun === null) return unknown("scope_or_fence_changed");
  const resumedCheckpoint = resumedRun?.checkpoint ?? null;
  const versionedResume = resumedCheckpoint?.checkpointVersion === 1;
  const startingPass = versionedResume ? resumedCheckpoint.pass + (resumedCheckpoint.passComplete ? 1 : 0) : 0;
  let previousPass: string | null = versionedResume ? normalizedFingerprint(resumedCheckpoint.previousPassFingerprint) : null;
  const durableContinuation = resumableCheckpoint(resumedCheckpoint, resumedRun?.observations ?? []);
  let providerObservedAt: Date | null = resumedRun?.providerObservedAt ?? null;
  for (let pass = startingPass; pass < options.maxPasses; pass += 1) {
    const continuing = durableContinuation?.pass === pass;
    const passObservations: AuditObservation[] = continuing ? [...(resumedRun?.observations ?? [])] : [];
    let offset = continuing ? durableContinuation.offset : 0;
    let expectedTotal = offset;
    let finalCheckpoint = continuing ? durableContinuation : checkpoint(pass, offset, 0, 0, undefined, null, previousPass);
    let pageCheckpoint: PollCheckpoint | null = continuing && offset > 0 ? durableContinuation.pageCheckpoint ?? null : null;
    let resumeItemIndex = continuing ? durableContinuation.itemIndex : -1;
    let responseObservedAt: Date | null = null;
    do {
      if (options.signal?.aborted) return unknown("timeout");
      const pageLeaseCurrent = await persistence.isLeaseCurrent(lease);
      if (options.signal?.aborted) return unknown("timeout");
      if (!pageLeaseCurrent) return unknown("scope_or_fence_changed");
      const page = await source.readPage(offset, options.pageSize, pageCheckpoint, options.signal);
      if (options.signal?.aborted) return unknown("timeout");
      if (page.kind !== "accepted") return unknown(page.reasonCode);
      responseObservedAt ??= page.providerObservedAt;
      providerObservedAt ??= page.providerObservedAt;
      if (page.providerObservedAt.getTime() !== responseObservedAt.getTime()) return unknown("malformed_response");
      let firstItemIndex = 0;
      if (resumeItemIndex >= 0) {
        if (!matchesResumedPrefix(durableContinuation!, page.value.changes, passObservations)) {
          passObservations.length = 0;
          offset = 0;
          expectedTotal = 0;
          finalCheckpoint = checkpoint(pass, 0, 0, 0, undefined, null, previousPass);
          pageCheckpoint = null;
          resumeItemIndex = -1;
          continue;
        }
        firstItemIndex = resumeItemIndex + 1;
        resumeItemIndex = -1;
      }
      expectedTotal += page.value.changes.length;
      for (let itemIndex = firstItemIndex; itemIndex < page.value.changes.length; itemIndex += 1) {
        if (options.signal?.aborted) return unknown("timeout");
        const detailLeaseCurrent = await persistence.isLeaseCurrent(lease);
        if (options.signal?.aborted) return unknown("timeout");
        if (!detailLeaseCurrent) return unknown("scope_or_fence_changed");
        const issue = page.value.changes[itemIndex]!;
        const detail = await source.readIssueDetail(issue.identity.remoteId, options.signal);
        if (options.signal?.aborted) return unknown("timeout");
        if (detail.kind !== "accepted") return unknown(detail.kind === "unknown" ? detail.reasonCode : "detail_drift");
        if (detail.providerObservedAt.getTime() !== responseObservedAt.getTime()) return unknown("malformed_response");
        const observations = normalizedObservations(detail.value);
        if (passObservations.length + observations.length > MAX_AUDIT_OBSERVATIONS_PER_RUN) return unknown("malformed_response");
        const nextCheckpoint = checkpoint(pass, offset, itemIndex, expectedTotal, issue, pageCheckpoint, previousPass);
        const committed = await persistence.commitIssue({
          lease,
          providerObservedAt,
          observations,
          checkpoint: nextCheckpoint,
          replace: passObservations.length === 0 && (pass > 0 || resumedRun !== undefined),
        });
        if (options.signal?.aborted) return unknown("timeout");
        if (!committed) {
          return unknown("scope_or_fence_changed");
        }
        passObservations.push(...observations);
        finalCheckpoint = nextCheckpoint;
      }
      offset += page.value.changes.length;
      pageCheckpoint = page.value.nextCheckpoint;
      if (page.value.hasMore && page.value.changes.length === 0) return unknown("pagination_drift");
      if (!page.value.hasMore) break;
    } while (true);

    const currentPass = fingerprint(passObservations);
    if (previousPass === currentPass) {
      if (passObservations.length === 0) {
        const committed = await persistence.commitIssue({ lease, providerObservedAt: providerObservedAt!, observations: [], checkpoint: finalCheckpoint, replace: true });
        if (options.signal?.aborted) return unknown("timeout");
        if (!committed) return unknown("scope_or_fence_changed");
      }
      const finalLeaseCurrent = await persistence.isLeaseCurrent(lease);
      if (options.signal?.aborted) return unknown("timeout");
      if (!finalLeaseCurrent) return unknown("scope_or_fence_changed");
      const finished = await persistence.finish({ lease, providerObservedAt: providerObservedAt! });
      if (options.signal?.aborted) return unknown("timeout");
      if (!finished) return unknown("scope_or_fence_changed");
      return { kind: "complete-current-visible", scopeFingerprint: lease.scopeFingerprint };
    }
    const completedPassCheckpoint = { ...finalCheckpoint, checkpointVersion: 1 as const, pageCheckpoint: null, previousPassFingerprint: currentPass, passComplete: true };
    const committed = await persistence.commitIssue({
      lease,
      providerObservedAt: providerObservedAt!,
      observations: [],
      checkpoint: completedPassCheckpoint,
      replace: passObservations.length === 0 && (pass > 0 || resumedRun !== undefined),
    });
    if (options.signal?.aborted) return unknown("timeout");
    if (!committed) return unknown("scope_or_fence_changed");
    previousPass = currentPass;
  }
  return unknown("did_not_converge");
}
