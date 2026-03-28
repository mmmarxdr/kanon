import { describe, it, expect } from "vitest";
import { DiffDetector } from "./diff-detector.js";
import type { DiffIssue, ExportCandidate, ImportCandidate } from "./diff-detector.js";
import { SyncStateManager } from "./sync-state.js";
import type { EngramObservation, SyncState } from "./types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSyncState(overrides: Partial<SyncState> = {}): SyncState {
  const content = "Test Issue\nSome description";
  return {
    engramId: 100,
    topicKey: "sdd/test/proposal",
    syncedAt: "2026-01-01T00:00:00Z",
    contentHash: SyncStateManager.computeHash(content),
    engramRevision: 1,
    direction: "exported",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<DiffIssue> = {}): DiffIssue {
  return {
    key: "KANON-1",
    title: "Test Issue",
    description: "Some description",
    engramContext: null,
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<EngramObservation> = {},
): EngramObservation {
  return {
    id: 100,
    sync_id: "sync-1",
    session_id: "session-1",
    type: "discovery",
    title: "Test Observation",
    content: "Observation content",
    project: "kanon",
    scope: "project",
    topic_key: "sdd/test/proposal",
    revision_count: 1,
    duplicate_count: 0,
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── buildIssueContent ──────────────────────────────────────────────────────

describe("DiffDetector.buildIssueContent", () => {
  it("concatenates title and description", () => {
    const issue = makeIssue({
      title: "My Title",
      description: "My description",
    });
    expect(DiffDetector.buildIssueContent(issue)).toBe(
      "My Title\nMy description",
    );
  });

  it("uses empty string when description is null", () => {
    const issue = makeIssue({ title: "Title Only", description: null });
    expect(DiffDetector.buildIssueContent(issue)).toBe("Title Only\n");
  });

  it("uses empty string when description is undefined", () => {
    const issue = makeIssue({ title: "Title Only" });
    delete issue.description;
    expect(DiffDetector.buildIssueContent(issue)).toBe("Title Only\n");
  });
});

// ─── classify ────────────────────────────────────────────────────────────────

describe("DiffDetector.classify", () => {
  it("returns 'new' when syncState is null", () => {
    const issue = makeIssue();
    expect(DiffDetector.classify(issue, null)).toBe("new");
  });

  it("returns 'unchanged' when content and revision match", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({ engramContext: syncState });
    const observation = makeObservation({ revision_count: 1 });

    expect(DiffDetector.classify(issue, syncState, observation)).toBe(
      "unchanged",
    );
  });

  it("returns 'kanon-modified' when issue content changed", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({
      title: "Changed Title",
      description: "Changed description",
      engramContext: syncState,
    });
    const observation = makeObservation({ revision_count: 1 });

    expect(DiffDetector.classify(issue, syncState, observation)).toBe(
      "kanon-modified",
    );
  });

  it("returns 'engram-modified' when observation revision bumped", () => {
    const syncState = makeSyncState({ engramRevision: 1 });
    const issue = makeIssue({ engramContext: syncState });
    const observation = makeObservation({ revision_count: 5 });

    expect(DiffDetector.classify(issue, syncState, observation)).toBe(
      "engram-modified",
    );
  });

  it("returns 'both-modified' when both sides changed", () => {
    const syncState = makeSyncState({ engramRevision: 1 });
    const issue = makeIssue({
      title: "Changed Title",
      description: "Changed description",
      engramContext: syncState,
    });
    const observation = makeObservation({ revision_count: 5 });

    expect(DiffDetector.classify(issue, syncState, observation)).toBe(
      "both-modified",
    );
  });

  it("returns 'unchanged' when no observation provided and content matches", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({ engramContext: syncState });

    expect(DiffDetector.classify(issue, syncState, null)).toBe("unchanged");
  });

  it("returns 'unchanged' when observation is undefined and content matches", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({ engramContext: syncState });

    expect(DiffDetector.classify(issue, syncState, undefined)).toBe(
      "unchanged",
    );
  });
});

// ─── findExportCandidates ────────────────────────────────────────────────────

describe("DiffDetector.findExportCandidates", () => {
  it("returns empty array for empty input", () => {
    expect(DiffDetector.findExportCandidates([])).toEqual([]);
  });

  it("skips unchanged items", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({ engramContext: syncState });
    const observations = new Map<number, EngramObservation>();
    observations.set(100, makeObservation({ revision_count: 1 }));

    const candidates = DiffDetector.findExportCandidates(
      [issue],
      observations,
    );
    expect(candidates).toHaveLength(0);
  });

  it("skips engram-modified items (not export candidates)", () => {
    const syncState = makeSyncState({ engramRevision: 1 });
    const issue = makeIssue({ engramContext: syncState });
    const observations = new Map<number, EngramObservation>();
    observations.set(100, makeObservation({ revision_count: 5 }));

    const candidates = DiffDetector.findExportCandidates(
      [issue],
      observations,
    );
    expect(candidates).toHaveLength(0);
  });

  it("queues items with no sync state as 'create'", () => {
    const issue = makeIssue({ engramContext: null });

    const candidates = DiffDetector.findExportCandidates([issue]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("create");
    expect(candidates[0]!.syncState).toBeNull();
    expect(candidates[0]!.issue).toBe(issue);
  });

  it("queues kanon-modified items as 'update'", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({
      title: "Updated Title",
      description: "Updated description",
      engramContext: syncState,
    });
    const observations = new Map<number, EngramObservation>();
    observations.set(100, makeObservation({ revision_count: 1 }));

    const candidates = DiffDetector.findExportCandidates(
      [issue],
      observations,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("update");
    expect(candidates[0]!.syncState).toEqual(syncState);
  });

  it("queues both-modified items as 'update' with conflict reason", () => {
    const syncState = makeSyncState({ engramRevision: 1 });
    const issue = makeIssue({
      title: "Changed Title",
      description: "Changed description",
      engramContext: syncState,
    });
    const observations = new Map<number, EngramObservation>();
    observations.set(100, makeObservation({ revision_count: 5 }));

    const candidates = DiffDetector.findExportCandidates(
      [issue],
      observations,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("update");
    expect(candidates[0]!.reason).toContain("conflict");
  });

  it("handles multiple issues with mixed classifications", () => {
    const syncState = makeSyncState();
    const unchangedIssue = makeIssue({
      key: "KANON-1",
      engramContext: syncState,
    });
    const newIssue = makeIssue({
      key: "KANON-2",
      title: "Brand New",
      engramContext: null,
    });
    const modifiedIssue = makeIssue({
      key: "KANON-3",
      title: "Modified Content",
      description: "Different description",
      engramContext: syncState,
    });

    const observations = new Map<number, EngramObservation>();
    observations.set(100, makeObservation({ revision_count: 1 }));

    const candidates = DiffDetector.findExportCandidates(
      [unchangedIssue, newIssue, modifiedIssue],
      observations,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.issue.key).toBe("KANON-2");
    expect(candidates[0]!.action).toBe("create");
    expect(candidates[1]!.issue.key).toBe("KANON-3");
    expect(candidates[1]!.action).toBe("update");
  });

  it("works without observations argument", () => {
    const syncState = makeSyncState();
    const issue = makeIssue({
      title: "Changed",
      description: "Changed",
      engramContext: syncState,
    });

    const candidates = DiffDetector.findExportCandidates([issue]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("update");
  });
});

// ─── findImportCandidates ────────────────────────────────────────────────────

describe("DiffDetector.findImportCandidates", () => {
  it("returns empty array for empty input", () => {
    expect(
      DiffDetector.findImportCandidates([], new Map()),
    ).toEqual([]);
  });

  it("skips observations without a topic_key", () => {
    const observation = makeObservation();
    delete (observation as unknown as Record<string, unknown>)["topic_key"];

    const candidates = DiffDetector.findImportCandidates(
      [observation],
      new Map(),
    );
    expect(candidates).toHaveLength(0);
  });

  it("queues observations with no matching sync state as 'create'", () => {
    const observation = makeObservation({ topic_key: "sdd/new/proposal" });

    const candidates = DiffDetector.findImportCandidates(
      [observation],
      new Map(),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("create");
    expect(candidates[0]!.syncState).toBeNull();
    expect(candidates[0]!.observation).toBe(observation);
  });

  it("skips unchanged observations (revision matches)", () => {
    const syncState = makeSyncState({
      topicKey: "sdd/test/proposal",
      engramRevision: 3,
    });
    const syncStates = new Map<string, SyncState>();
    syncStates.set("sdd/test/proposal", syncState);

    const observation = makeObservation({
      topic_key: "sdd/test/proposal",
      revision_count: 3,
    });

    const candidates = DiffDetector.findImportCandidates(
      [observation],
      syncStates,
    );
    expect(candidates).toHaveLength(0);
  });

  it("queues engram-modified observations as 'update'", () => {
    const syncState = makeSyncState({
      topicKey: "sdd/test/proposal",
      engramRevision: 1,
    });
    const syncStates = new Map<string, SyncState>();
    syncStates.set("sdd/test/proposal", syncState);

    const observation = makeObservation({
      topic_key: "sdd/test/proposal",
      revision_count: 5,
    });

    const candidates = DiffDetector.findImportCandidates(
      [observation],
      syncStates,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("update");
    expect(candidates[0]!.syncState).toEqual(syncState);
  });

  it("handles multiple observations with mixed statuses", () => {
    const syncState = makeSyncState({
      topicKey: "sdd/existing/proposal",
      engramRevision: 2,
    });
    const syncStates = new Map<string, SyncState>();
    syncStates.set("sdd/existing/proposal", syncState);

    const newObs = makeObservation({
      id: 200,
      topic_key: "sdd/brand-new/proposal",
    });
    const unchangedObs = makeObservation({
      id: 100,
      topic_key: "sdd/existing/proposal",
      revision_count: 2,
    });
    const modifiedObs = makeObservation({
      id: 300,
      topic_key: "sdd/existing/proposal",
      revision_count: 10,
    });

    // Re-add sync state for the modified observation's topic_key
    // (same key as unchanged, but different revision in the obs)
    const candidates = DiffDetector.findImportCandidates(
      [newObs, unchangedObs, modifiedObs],
      syncStates,
    );

    // newObs = create (no sync state), unchangedObs = skip, modifiedObs = update
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.action).toBe("create");
    expect(candidates[0]!.observation.id).toBe(200);
    expect(candidates[1]!.action).toBe("update");
    expect(candidates[1]!.observation.id).toBe(300);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("DiffDetector edge cases", () => {
  it("classify returns 'new' when syncState is null regardless of observation", () => {
    const issue = makeIssue();
    const observation = makeObservation({ revision_count: 99 });

    expect(DiffDetector.classify(issue, null, observation)).toBe("new");
  });

  it("findExportCandidates handles invalid engramContext gracefully", () => {
    const issue = makeIssue({ engramContext: { bogus: true } });

    const candidates = DiffDetector.findExportCandidates([issue]);
    // Invalid engramContext parses as null sync state -> classified as "new"
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("create");
  });

  it("findExportCandidates handles engramContext as a string", () => {
    const issue = makeIssue({ engramContext: "not-an-object" });

    const candidates = DiffDetector.findExportCandidates([issue]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("create");
  });

  it("findImportCandidates skips observations with null topic_key", () => {
    const observation = makeObservation({ topic_key: undefined });

    const candidates = DiffDetector.findImportCandidates(
      [observation],
      new Map(),
    );
    expect(candidates).toHaveLength(0);
  });

  it("findExportCandidates with missing hash in sync state still detects change", () => {
    // A sync state with a contentHash that won't match current content
    const syncState = makeSyncState({
      contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    const issue = makeIssue({ engramContext: syncState });

    const candidates = DiffDetector.findExportCandidates([issue]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.action).toBe("update");
    expect(candidates[0]!.reason).toContain("changed");
  });
});
