import { createHash } from "node:crypto";

export const REDMINE_RECONCILIATION_SCORER_VERSION = "redmine-reconciliation-score.v1";
export const MAX_REDMINE_RECONCILIATION_RECOMMENDATIONS = 3;

const DAY_MS = 86_400_000;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

export interface LocalReconciliationCandidate {
  readonly id: string;
  readonly key: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly description?: string | null;
  readonly createdAt?: string | Date | null;
  readonly assigneeId?: string | null;
  readonly state?: string | null;
}

export interface RemoteReconciliationIssue {
  readonly id: string;
  /** Resolved Kanon project identity from the project binding. */
  readonly projectId: string;
  readonly title: string | null;
  readonly description?: string | null;
  readonly createdAt?: string | Date | null;
  readonly mappedAssigneeId?: string | null;
  readonly mappedState?: string | null;
}

export interface RedmineReconciliationFactorEvidence {
  readonly scorerVersion: typeof REDMINE_RECONCILIATION_SCORER_VERSION;
  readonly projectEligible: true;
  readonly titleContribution: number;
  readonly descriptionContribution: number;
  readonly dateComparable: boolean;
  readonly dateContribution: number;
  readonly assigneeComparable: boolean;
  readonly assigneeContribution: number;
  readonly stateComparable: boolean;
  readonly stateContribution: number;
  readonly score: number;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
}

export interface RedmineReconciliationScore {
  readonly candidateIssueId: string;
  readonly candidateIssueKey: string;
  readonly score: number;
  readonly evidence: RedmineReconciliationFactorEvidence;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function normalizeReconciliationTokenSet(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("ß", "ss").replaceAll("ς", "σ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    ? [...new Set(normalized.split(" "))].sort(compareCodePoints)
    : [];
}

function tokenContribution(left: readonly string[], right: readonly string[], maximum: number) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return Math.round((maximum * intersection) / union);
}

function canonicalIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim();
  return normalized ? normalized : null;
}

function utcDay(value: string | Date | null | undefined): number | null {
  const input = typeof value === "string" && DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00.000Z` : value;
  const timestamp = input instanceof Date ? input.getTime() : typeof input === "string" && RFC3339_PATTERN.test(input) ? Date.parse(input) : Number.NaN;
  return Number.isFinite(timestamp) ? Math.floor(timestamp / DAY_MS) : null;
}

function fingerprint(kind: "local" | "remote", values: readonly unknown[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([REDMINE_RECONCILIATION_SCORER_VERSION, kind, ...values]))
    .digest("hex");
  return `sha256:${digest}`;
}

function localFingerprint(candidate: LocalReconciliationCandidate): string {
  return fingerprint("local", [
    canonicalIdentifier(candidate.projectId),
    canonicalIdentifier(candidate.id),
    canonicalIdentifier(candidate.key),
    normalizeReconciliationTokenSet(candidate.title),
    normalizeReconciliationTokenSet(candidate.description),
    utcDay(candidate.createdAt),
    canonicalIdentifier(candidate.assigneeId),
    canonicalIdentifier(candidate.state),
  ]);
}

function remoteFingerprint(issue: RemoteReconciliationIssue): string {
  return fingerprint("remote", [
    canonicalIdentifier(issue.projectId),
    canonicalIdentifier(issue.id),
    normalizeReconciliationTokenSet(issue.title),
    normalizeReconciliationTokenSet(issue.description),
    utcDay(issue.createdAt),
    canonicalIdentifier(issue.mappedAssigneeId),
    canonicalIdentifier(issue.mappedState),
  ]);
}

function compareMapped(left: string | null | undefined, right: string | null | undefined) {
  const a = canonicalIdentifier(left);
  const b = canonicalIdentifier(right);
  return { comparable: a !== null && b !== null, matches: a !== null && a === b };
}

export function scoreRedmineReconciliationCandidate(
  remote: RemoteReconciliationIssue,
  candidate: LocalReconciliationCandidate,
): RedmineReconciliationScore | null {
  const remoteProject = canonicalIdentifier(remote.projectId);
  if (!remoteProject || remoteProject !== canonicalIdentifier(candidate.projectId)) return null;

  const titleContribution = tokenContribution(
    normalizeReconciliationTokenSet(remote.title),
    normalizeReconciliationTokenSet(candidate.title),
    50,
  );
  const descriptionContribution = tokenContribution(
    normalizeReconciliationTokenSet(remote.description),
    normalizeReconciliationTokenSet(candidate.description),
    25,
  );
  const remoteDay = utcDay(remote.createdAt);
  const localDay = utcDay(candidate.createdAt);
  const dateComparable = remoteDay !== null && localDay !== null;
  const dateContribution = dateComparable ? Math.max(0, 10 - Math.abs(remoteDay - localDay)) : 0;
  const assignee = compareMapped(remote.mappedAssigneeId, candidate.assigneeId);
  const state = compareMapped(remote.mappedState, candidate.state);
  const assigneeContribution = assignee.matches ? 10 : 0;
  const stateContribution = state.matches ? 5 : 0;
  const score = titleContribution + descriptionContribution + dateContribution + assigneeContribution + stateContribution;
  const evidence: RedmineReconciliationFactorEvidence = {
    scorerVersion: REDMINE_RECONCILIATION_SCORER_VERSION,
    projectEligible: true,
    titleContribution,
    descriptionContribution,
    dateComparable,
    dateContribution,
    assigneeComparable: assignee.comparable,
    assigneeContribution,
    stateComparable: state.comparable,
    stateContribution,
    score,
    localFingerprint: localFingerprint(candidate),
    remoteFingerprint: remoteFingerprint(remote),
  };
  return { candidateIssueId: candidate.id, candidateIssueKey: candidate.key, score, evidence };
}

export function rankRedmineReconciliationCandidates(
  remote: RemoteReconciliationIssue,
  candidates: readonly LocalReconciliationCandidate[],
): RedmineReconciliationScore[] {
  return candidates
    .map((candidate) => scoreRedmineReconciliationCandidate(remote, candidate))
    .filter((candidate): candidate is RedmineReconciliationScore => candidate !== null)
    .sort((left, right) =>
      right.score - left.score
      || compareCodePoints(left.candidateIssueKey.normalize("NFKC"), right.candidateIssueKey.normalize("NFKC"))
      || compareCodePoints(left.candidateIssueId, right.candidateIssueId))
    .slice(0, MAX_REDMINE_RECONCILIATION_RECOMMENDATIONS);
}

const EVIDENCE_KEYS = [
  "assigneeComparable", "assigneeContribution", "dateComparable", "dateContribution",
  "descriptionContribution", "localFingerprint", "projectEligible", "remoteFingerprint",
  "score", "scorerVersion", "stateComparable", "stateContribution", "titleContribution",
].sort();

const boundedInteger = (value: unknown, maximum: number) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum;

export function isRedmineReconciliationFactorEvidence(
  value: unknown,
): value is RedmineReconciliationFactorEvidence {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const evidence = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(EVIDENCE_KEYS)) return false;
  if (evidence["scorerVersion"] !== REDMINE_RECONCILIATION_SCORER_VERSION || evidence["projectEligible"] !== true) return false;
  if (typeof evidence["dateComparable"] !== "boolean" || typeof evidence["assigneeComparable"] !== "boolean" || typeof evidence["stateComparable"] !== "boolean") return false;
  if (!boundedInteger(evidence["titleContribution"], 50) || !boundedInteger(evidence["descriptionContribution"], 25) || !boundedInteger(evidence["dateContribution"], 10)) return false;
  if (![0, 10].includes(evidence["assigneeContribution"] as number) || ![0, 5].includes(evidence["stateContribution"] as number)) return false;
  if (!evidence["dateComparable"] && evidence["dateContribution"] !== 0) return false;
  if (!evidence["assigneeComparable"] && evidence["assigneeContribution"] !== 0) return false;
  if (!evidence["stateComparable"] && evidence["stateContribution"] !== 0) return false;
  const total = ["titleContribution", "descriptionContribution", "dateContribution", "assigneeContribution", "stateContribution"]
    .reduce((sum, key) => sum + (evidence[key] as number), 0);
  return evidence["score"] === total
    && typeof evidence["localFingerprint"] === "string" && HASH_PATTERN.test(evidence["localFingerprint"])
    && typeof evidence["remoteFingerprint"] === "string" && HASH_PATTERN.test(evidence["remoteFingerprint"]);
}

export function assertRedmineReconciliationFactorEvidence(
  value: unknown,
): asserts value is RedmineReconciliationFactorEvidence {
  if (!isRedmineReconciliationFactorEvidence(value)) {
    throw new TypeError("Invalid Redmine reconciliation factor evidence");
  }
}
