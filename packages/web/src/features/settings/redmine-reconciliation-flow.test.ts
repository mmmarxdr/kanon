import { describe, expect, it } from "vitest";
import {
  classifyRedmineReconciliationFailure,
  createRedmineReconciliationFlowState,
  redmineReconciliationFlowReducer,
  type RedmineReconciliationActivationProgress,
  type RedmineReconciliationPreviewProgress,
  type RedmineReconciliationReviewItem,
  type RedmineReconciliationReviewPage,
} from "./redmine-reconciliation-flow";

const PREVIEW_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PREVIEW_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE = `sha256:${"a".repeat(64)}`;
const LOCAL_ID = "33333333-3333-4333-8333-333333333333";
const factors = (score: number) => ({ scorerVersion: "redmine-reconciliation-score.v1", projectEligible: true, titleContribution: score, descriptionContribution: 0, dateComparable: false, dateContribution: 0, assigneeComparable: false, assigneeContribution: 0 as const, stateComparable: false, stateContribution: 0 as const, score, localFingerprint: SOURCE, remoteFingerprint: SOURCE } as const);

function preview(
  overrides: Partial<RedmineReconciliationPreviewProgress> = {},
): RedmineReconciliationPreviewProgress {
  return {
    previewIdentity: PREVIEW_ID,
    mode: "full",
    cutoff: "2026-08-24T12:00:00.000Z",
    checkpoint: null,
    complete: true,
    scannedCount: 3,
    remainingCount: 0,
    eligibleUnlinkedCount: 3,
    excludedPrivateCount: 0,
    linkedCount: 0,
    mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] },
    ...overrides,
  };
}

function item(id: string, title = `Remote ${id}`, score?: number): RedmineReconciliationReviewItem {
  return {
    remote: { id, title, sourceVersion: SOURCE },
    recommendations: [],
    manualCandidate: score === undefined ? null : { score, factorEvidence: factors(score), localIssue: { id: LOCAL_ID, key: "KAN-1", title: "Local" } },
  };
}

function page(
  items: RedmineReconciliationReviewItem[],
  nextCursor: string | null,
  remainingCandidateCount: number,
  hiddenCount = 0,
  linkedCount = 0,
  previewIdentity = PREVIEW_ID,
): RedmineReconciliationReviewPage {
  return {
    previewIdentity,
    processedCandidateCount: items.length + hiddenCount + linkedCount,
    remainingCandidateCount,
    hiddenCount,
    linkedCount,
    items,
    nextCursor,
  };
}

function beginReview() {
  let state = redmineReconciliationFlowReducer(
    createRedmineReconciliationFlowState("binding-a"),
    { type: "mode-selected", mode: "full" },
  );
  return redmineReconciliationFlowReducer(state, {
    type: "preview-succeeded",
    progress: preview(),
  });
}

const activation = (complete: boolean, replayed = false): RedmineReconciliationActivationProgress => ({ importedCount: complete ? 1 : 0, issueKeys: complete ? ["KAN-1"] : [], replayed, complete, processedCount: complete ? 1 : 0, remainingCount: complete ? 0 : 1 });

describe("redmineReconciliationFlowReducer", () => {
  it("isolates binding state and fully resets on mode selection or reset", () => {
    const initial = createRedmineReconciliationFlowState("binding-a");
    let state = redmineReconciliationFlowReducer(initial, {
      type: "mode-selected",
      mode: "future_only",
    });
    state = redmineReconciliationFlowReducer(state, {
      type: "preview-succeeded",
      progress: preview({ mode: "future_only", eligibleUnlinkedCount: 0 }),
    });
    state = redmineReconciliationFlowReducer(state, { type: "activation-started" });
    state = redmineReconciliationFlowReducer(state, {
      type: "activation-succeeded",
      progress: activation(false),
    });
    state = redmineReconciliationFlowReducer(state, {
      type: "failed",
      stage: "activation",
      code: "REDMINE_CONNECTION_FAILED",
      message: "Retry",
    });

    expect(
      redmineReconciliationFlowReducer(state, { type: "mode-selected", mode: "full" }),
    ).toEqual({ ...initial, phase: "preview", selectedMode: "full" });
    expect(redmineReconciliationFlowReducer(state, { type: "reset" })).toEqual(initial);
    expect(createRedmineReconciliationFlowState("binding-b").bindingId).toBe("binding-b");
  });

  it("derives preview phases from completion, mode, candidates, and mapping gaps", () => {
    const start = (mode: "full" | "future_only") =>
      redmineReconciliationFlowReducer(createRedmineReconciliationFlowState("binding-a"), {
        type: "mode-selected",
        mode,
      });
    const apply = (mode: "full" | "future_only", progress: RedmineReconciliationPreviewProgress) =>
      redmineReconciliationFlowReducer(start(mode), { type: "preview-succeeded", progress });

    expect(apply("full", preview({ complete: false })).phase).toBe("preview");
    expect(
      apply("future_only", preview({ mode: "future_only", eligibleUnlinkedCount: 0 })).phase,
    ).toBe("activation-ready");
    expect(
      apply(
        "full",
        preview({ mappingGaps: { statusIds: ["4"], priorityIds: [], assigneeRemoteUserIds: [] } }),
      ).phase,
    ).toBe("mapping-blocked");
    expect(apply("full", preview()).phase).toBe("review");
    expect(apply("full", preview({ eligibleUnlinkedCount: 0 })).phase).toBe("activation-ready");
  });

  it("rejects stale identities and unexpected cursors without changing review progress", () => {
    const first = redmineReconciliationFlowReducer(beginReview(), {
      type: "review-succeeded",
      requestedCursor: undefined,
      page: page([item("1")], "next", 1, 1),
    });
    for (const action of [
      { type: "review-succeeded" as const, requestedCursor: "next", page: page([item("2")], null, 0, 0, 0, OTHER_PREVIEW_ID) },
      { type: "review-succeeded" as const, requestedCursor: "wrong", page: page([item("2")], null, 0) },
    ]) {
      const rejected = redmineReconciliationFlowReducer(first, action);
      expect(rejected).toMatchObject({
        phase: "error",
        unresolvedItems: first.unresolvedItems,
        expectedNextCursor: "next",
        remainingCandidateCount: 1,
        hiddenCount: 1,
        linkedCount: 0,
        failure: { code: "REDMINE_RECONCILIATION_PAGE_INVALID", recovery: "fatal" },
      });
    }
  });

  it("aggregates ordered pages and accepts exact replay without duplicate items or counts", () => {
    const firstAction = {
      type: "review-succeeded" as const,
      requestedCursor: undefined,
      page: page([item("1"), item("2")], "next", 2, 1),
    };
    const first = redmineReconciliationFlowReducer(beginReview(), firstAction);
    expect(redmineReconciliationFlowReducer(first, firstAction)).toBe(first);

    const final = redmineReconciliationFlowReducer(first, {
      type: "review-succeeded",
      requestedCursor: "next",
      page: page([item("2"), item("3")], null, 0, 0, 1),
    });
    expect(final.unresolvedItems.map(({ remote }) => remote.id)).toEqual(["1", "2", "3"]);
    expect(final).toMatchObject({
      phase: "review",
      expectedNextCursor: null,
      remainingCandidateCount: 0,
      hiddenCount: 1,
      linkedCount: 1,
    });
  });

  it("requires resolved visible items and complete paging before bounded activation", () => {
    let state = redmineReconciliationFlowReducer(beginReview(), {
      type: "review-succeeded",
      requestedCursor: undefined,
      page: page([item("1")], "next", 1),
    });
    expect(redmineReconciliationFlowReducer(state, { type: "activation-started" })).toBe(state);
    state = redmineReconciliationFlowReducer(state, { type: "remote-resolved", remoteIssueId: "1" });
    expect(state.phase).toBe("review");
    expect(redmineReconciliationFlowReducer(state, { type: "activation-started" })).toBe(state);
    state = redmineReconciliationFlowReducer(state, {
      type: "review-succeeded",
      requestedCursor: "next",
      page: page([item("2")], null, 0),
    });
    expect(redmineReconciliationFlowReducer(state, { type: "activation-started" })).toBe(state);
    state = redmineReconciliationFlowReducer(state, { type: "remote-resolved", remoteIssueId: "2" });
    expect(state.phase).toBe("activation-ready");
    state = redmineReconciliationFlowReducer(state, { type: "activation-started" });
    expect(state.phase).toBe("activation");
    state = redmineReconciliationFlowReducer(state, {
      type: "activation-succeeded",
      progress: activation(false),
    });
    expect(state).toMatchObject({ phase: "activation", activationProgress: { remainingCount: 1 } });
    const failed = redmineReconciliationFlowReducer(state, { type: "failed", stage: "activation", code: "REDMINE_CONNECTION_FAILED", message: "Retry" });
    expect(redmineReconciliationFlowReducer(failed, { type: "activation-succeeded", progress: activation(true, true) }).phase).toBe("complete");
    state = redmineReconciliationFlowReducer(failed, { type: "activation-started" });
    expect(state).toMatchObject({ phase: "activation", activationProgress: { remainingCount: 1 }, failure: null });
    state = redmineReconciliationFlowReducer(state, {
      type: "activation-succeeded",
      progress: activation(true, true),
    });
    expect(state).toMatchObject({ phase: "complete", activationProgress: { replayed: true } });
    for (const invalid of [
      redmineReconciliationFlowReducer(state, { type: "failed", stage: "review", code: "REDMINE_CONNECTION_FAILED", message: "Wrong stage" }),
      redmineReconciliationFlowReducer(state, { type: "failed", stage: "activation", code: "UNKNOWN", message: "Fatal" }),
    ]) expect(redmineReconciliationFlowReducer(invalid, { type: "activation-started" })).toBe(invalid);
  });

  it("refreshes the matching unresolved item in place and preserves page progress", () => {
    const progressed = redmineReconciliationFlowReducer(beginReview(), { type: "review-succeeded", requestedCursor: undefined, page: page([item("1"), item("2")], "next", 1, 1, 1) });
    const failed = redmineReconciliationFlowReducer(progressed, { type: "failed", stage: "review", code: "REDMINE_RECONCILIATION_LOCAL_STALE", message: "Refresh" });
    const refreshed = redmineReconciliationFlowReducer(failed, { type: "item-refreshed", item: item("1", "Updated remote", 40) });
    expect(refreshed.unresolvedItems.map(({ remote }) => remote.title)).toEqual(["Updated remote", "Remote 2"]);
    expect(refreshed.unresolvedItems[0]?.manualCandidate?.factorEvidence.score).toBe(40);
    expect(refreshed).toMatchObject({ phase: "review", previewProgress: progressed.previewProgress, expectedNextCursor: "next", remainingCandidateCount: 1, hiddenCount: 1, linkedCount: 1, failure: null });
    expect(redmineReconciliationFlowReducer(failed, { type: "item-refreshed", item: item("9") })).toBe(failed);
    expect(redmineReconciliationFlowReducer(progressed, { type: "item-refreshed", item: item("1", "Ignored", 10) })).toBe(progressed);
  });

  it("classifies concrete failures and applies recovery-specific progress rules", () => {
    const table = {
      "restart-preview": ["REDMINE_PREVIEW_INVALID", "REDMINE_PREVIEW_STALE", "REDMINE_PREVIEW_REQUIRED", "REDMINE_RECONCILIATION_PREVIEW_REQUIRED", "REDMINE_RECONCILIATION_CURSOR_STALE", "REDMINE_RECONCILIATION_SCOPE_STALE", "REDMINE_RECONCILIATION_SOURCE_STALE", "REDMINE_RECONCILIATION_UNLISTED", "REDMINE_RECONCILIATION_PROJECT_MISMATCH", "REDMINE_RECONCILIATION_NOT_VISIBLE"],
      retry: ["REDMINE_CONNECTION_FAILED", "REDMINE_PREVIEW_IN_PROGRESS", "REDMINE_IMPORT_IN_PROGRESS", "REDMINE_IMPORT_RACE", "REDMINE_IMPORT_LIMIT"],
      "refresh-item": ["REDMINE_RECONCILIATION_LOCAL_STALE", "REDMINE_RECONCILIATION_REMOTE_STALE", "REDMINE_RECONCILIATION_RECOMMENDATION_STALE", "REDMINE_RECONCILIATION_CANDIDATE_LINKED", "REDMINE_RECONCILIATION_ALREADY_LINKED", "REDMINE_RECONCILIATION_CANDIDATE_INVALID", "REDMINE_RECONCILIATION_LINK_CONFLICT", "REDMINE_RECONCILIATION_RECOMMENDATION_NOT_FOUND", "REDMINE_RECONCILIATION_WRITE_CONFLICT"],
      blocked: ["REDMINE_RECONCILIATION_MAPPING_GAPS", "REDMINE_RECONCILIATION_MAPPING_INCOMPLETE", "REDMINE_STATUS_UNMAPPED", "REDMINE_PRIORITY_UNMAPPED", "REDMINE_ASSIGNEE_UNMAPPED", "PROVIDER_MAPS_REQUIRED", "REDMINE_RECONCILIATION_LIFECYCLE", "REDMINE_PREVIEW_LIFECYCLE", "INTEGRATION_NOT_ACTIVE", "INTEGRATION_NOT_READY", "REDMINE_RECONCILIATION_OUTBOUND_PENDING", "REDMINE_OUTBOUND_UNSETTLED", "REDMINE_RECONCILIATION_OUTBOUND_CREATE_UNCERTAIN", "REDMINE_NOT_CONFIGURED", "SERVICE_CREDENTIAL_REQUIRES_REPLACEMENT", "REDMINE_RECONCILIATION_PENDING", "REDMINE_IMPORT_ACTIVE"],
      fatal: ["FORBIDDEN", "UNAUTHORIZED", "INTEGRATION_CONNECTION_NOT_FOUND", "INTEGRATION_NOT_FOUND", "INTEGRATION_BINDING_NOT_FOUND", "SOMETHING_UNKNOWN"],
    } as const;
    for (const [recovery, codes] of Object.entries(table)) {
      expect(codes.map(classifyRedmineReconciliationFailure)).toEqual(
        Array.from({ length: codes.length }, () => recovery),
      );
    }

    const progressed = redmineReconciliationFlowReducer(beginReview(), {
      type: "review-succeeded",
      requestedCursor: undefined,
      page: page([item("1")], "next", 1, 1),
    });
    const fail = (code: string) =>
      redmineReconciliationFlowReducer(progressed, {
        type: "failed",
        stage: "review",
        code,
        message: code,
      });
    for (const code of ["REDMINE_RECONCILIATION_PROJECT_MISMATCH", "REDMINE_RECONCILIATION_NOT_VISIBLE"]) expect(fail(code)).toMatchObject({ previewProgress: null, unresolvedItems: [], failure: { recovery: "restart-preview" } });
    for (const code of ["REDMINE_IMPORT_LIMIT", "REDMINE_RECONCILIATION_CANDIDATE_INVALID", "REDMINE_RECONCILIATION_LINK_CONFLICT", "REDMINE_RECONCILIATION_RECOMMENDATION_NOT_FOUND", "REDMINE_RECONCILIATION_WRITE_CONFLICT"]) expect(fail(code)).toMatchObject({ previewProgress: progressed.previewProgress, unresolvedItems: progressed.unresolvedItems, expectedNextCursor: "next" });
    for (const code of ["REDMINE_RECONCILIATION_PENDING", "REDMINE_IMPORT_ACTIVE"]) expect(fail(code)).toMatchObject({ phase: "blocked", unresolvedItems: progressed.unresolvedItems, failure: { recovery: "blocked" } });
    expect(fail("REDMINE_PREVIEW_STALE")).toMatchObject({
      phase: "error",
      selectedMode: "full",
      previewProgress: null,
      unresolvedItems: [],
      expectedNextCursor: undefined,
      failure: { recovery: "restart-preview" },
    });
    for (const code of ["REDMINE_CONNECTION_FAILED", "REDMINE_RECONCILIATION_LOCAL_STALE"]) {
      expect(fail(code)).toMatchObject({
        phase: "error",
        unresolvedItems: progressed.unresolvedItems,
        hiddenCount: 1,
        expectedNextCursor: "next",
      });
    }
    expect(fail("REDMINE_RECONCILIATION_OUTBOUND_PENDING")).toMatchObject({
      phase: "blocked",
      unresolvedItems: progressed.unresolvedItems,
      failure: { recovery: "blocked" },
    });
    expect(fail("UNKNOWN")).toMatchObject({ phase: "error", failure: { recovery: "fatal" } });
  });
});
