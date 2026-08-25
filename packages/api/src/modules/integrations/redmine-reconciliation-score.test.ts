import { describe, expect, it } from "vitest";
import {
  REDMINE_RECONCILIATION_SCORER_VERSION,
  assertRedmineReconciliationFactorEvidence,
  isRedmineReconciliationFactorEvidence,
  normalizeReconciliationTokenSet,
  rankRedmineReconciliationCandidates,
  scoreRedmineReconciliationCandidate,
  type LocalReconciliationCandidate,
  type RemoteReconciliationIssue,
} from "./redmine-reconciliation-score.js";

const local = (overrides: Partial<LocalReconciliationCandidate> = {}): LocalReconciliationCandidate => ({
  id: "00000000-0000-4000-8000-000000000001",
  key: "KAN-1",
  projectId: "project-1",
  title: "Fix résumé API",
  description: "Handle failed webhooks safely",
  createdAt: "2026-08-20T23:30:00.000Z",
  assigneeId: "member-1",
  state: "in_progress",
  ...overrides,
});

const remote = (overrides: Partial<RemoteReconciliationIssue> = {}): RemoteReconciliationIssue => ({
  id: "100",
  projectId: "project-1",
  title: "FIX resume, API!",
  description: "Safely handle failed webhooks.",
  createdAt: "2026-08-20T12:00:00.000Z",
  mappedAssigneeId: "member-1",
  mappedState: "in_progress",
  ...overrides,
});

describe("Redmine reconciliation scoring", () => {
  it("normalizes Unicode, case, punctuation, whitespace, and duplicate tokens", () => {
    expect(normalizeReconciliationTokenSet("  HéLLO, hello—WORLD! Café Straße STRASSE  ")).toEqual([
      "cafe",
      "hello",
      "strasse",
      "world",
    ]);
    expect(normalizeReconciliationTokenSet(null)).toEqual([]);
    expect(normalizeReconciliationTokenSet("— !!!")).toEqual([]);
  });

  it("awards the fixed maximum contributions for an exact eligible match", () => {
    const result = scoreRedmineReconciliationCandidate(remote(), local());
    expect(result).toMatchObject({
      candidateIssueId: local().id,
      candidateIssueKey: "KAN-1",
      score: 100,
      evidence: {
        scorerVersion: REDMINE_RECONCILIATION_SCORER_VERSION,
        projectEligible: true,
        titleContribution: 50,
        descriptionContribution: 25,
        dateContribution: 10,
        assigneeContribution: 10,
        stateContribution: 5,
        score: 100,
      },
    });
    expect(isRedmineReconciliationFactorEvidence(result?.evidence)).toBe(true);
  });

  it("does not reward absent text, invalid dates, or unavailable mappings", () => {
    const result = scoreRedmineReconciliationCandidate(
      remote({
        title: "",
        description: null,
        createdAt: "not-a-date",
        mappedAssigneeId: null,
        mappedState: null,
      }),
      local({
        title: "",
        description: null,
        createdAt: null,
        assigneeId: null,
        state: null,
      }),
    );
    expect(result?.evidence).toMatchObject({
      titleContribution: 0,
      descriptionContribution: 0,
      dateComparable: false,
      dateContribution: 0,
      assigneeComparable: false,
      assigneeContribution: 0,
      stateComparable: false,
      stateContribution: 0,
      score: 0,
    });
  });

  it("scores UTC-day proximity and mapped equality deterministically", () => {
    const result = scoreRedmineReconciliationCandidate(
      remote({
        title: "different",
        description: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        mappedAssigneeId: "other",
        mappedState: "done",
      }),
      local({
        title: "unrelated",
        description: null,
        createdAt: "2026-08-20T23:59:59.000Z",
      }),
    );
    expect(result?.evidence).toMatchObject({
      dateComparable: true,
      dateContribution: 9,
      assigneeComparable: true,
      assigneeContribution: 0,
      stateComparable: true,
      stateContribution: 0,
      score: 9,
    });
    expect(scoreRedmineReconciliationCandidate(remote({ createdAt: "2026-08-21" }), local({ createdAt: "2026-08-21T00:00:00Z" }))?.evidence.dateContribution).toBe(10);
    expect(scoreRedmineReconciliationCandidate(remote({ createdAt: "2026-08-21T01:00:00+02:00" }), local({ createdAt: "2026-08-20T23:00:00Z" }))?.evidence.dateContribution).toBe(10);
    expect(scoreRedmineReconciliationCandidate(remote({ createdAt: "2026-08-20T23:30:00" }), local({ createdAt: "2026-08-20T23:30:00Z" }))?.evidence).toMatchObject({ dateComparable: false, dateContribution: 0 });
  });

  it("uses project identity as a hard eligibility gate", () => {
    expect(
      scoreRedmineReconciliationCandidate(remote({ projectId: "remote-project" }), local()),
    ).toBeNull();
  });

  it("returns only the stable top three using key then UUID tie breaks", () => {
    const candidates = [
      local({ id: "b", key: "KAN-1" }),
      local({ id: "z", key: "KAN-2" }),
      local({ id: "a", key: "KAN-1" }),
      local({ id: "x", key: "KAN-3" }),
      local({ id: "excluded", key: "KAN-0", projectId: "other" }),
    ];
    const expected = ["a", "b", "z"];
    expect(rankRedmineReconciliationCandidates(remote(), candidates).map(({ candidateIssueId }) => candidateIssueId)).toEqual(expected);
    expect(rankRedmineReconciliationCandidates(remote(), [...candidates].reverse()).map(({ candidateIssueId }) => candidateIssueId)).toEqual(expected);
  });

  it("keeps semantic fingerprints stable and changes them with scored content", () => {
    const first = scoreRedmineReconciliationCandidate(remote(), local())!;
    const equivalent = scoreRedmineReconciliationCandidate(
      remote({ title: "api — résumé fix", description: "WEBHOOKS failed; handle safely" }),
      local({ title: "API, resume fix", description: "safely failed handle webhooks" }),
    )!;
    const changed = scoreRedmineReconciliationCandidate(remote({ title: "Different work" }), local({ title: "Different work" }))!;
    expect(equivalent.evidence.localFingerprint).toBe(first.evidence.localFingerprint);
    expect(equivalent.evidence.remoteFingerprint).toBe(first.evidence.remoteFingerprint);
    expect(changed.evidence.localFingerprint).not.toBe(first.evidence.localFingerprint);
    expect(changed.evidence.remoteFingerprint).not.toBe(first.evidence.remoteFingerprint);
  });

  it("strictly rejects content-bearing or structurally invalid factor evidence", () => {
    const evidence = scoreRedmineReconciliationCandidate(remote(), local())!.evidence;
    expect(isRedmineReconciliationFactorEvidence(evidence)).toBe(true);
    expect(isRedmineReconciliationFactorEvidence({ ...evidence, rawTitle: "secret" })).toBe(false);
    expect(isRedmineReconciliationFactorEvidence({ ...evidence, titleContribution: "secret" })).toBe(false);
    expect(isRedmineReconciliationFactorEvidence({ ...evidence, score: 99 })).toBe(false);
    expect(isRedmineReconciliationFactorEvidence({ ...evidence, remoteFingerprint: "raw" })).toBe(false);
    expect(() => assertRedmineReconciliationFactorEvidence({ ...evidence, description: "secret" })).toThrow(TypeError);
  });
});
