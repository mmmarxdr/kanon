import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncEngine } from "../sync-engine.js";
import type {
  SyncableIssue,
  SyncKanonClient,
  SyncEngineConfig,
} from "../sync-engine.js";
import type { EngramClient } from "../engram-client.js";
import type { EngramObservation, SyncState } from "../types.js";
import { SyncStateManager } from "../sync-state.js";
import { ReverseEntityMapper } from "../reverse-entity-mapper.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeObservation(
  overrides: Partial<EngramObservation> = {},
): EngramObservation {
  return {
    id: 100,
    sync_id: "sync-1",
    session_id: "session-1",
    type: "kanon-issue",
    title: "KAN-1: Test Issue",
    content: "# KAN-1: Test Issue\n\nSome content",
    project: "kanon",
    scope: "project",
    topic_key: "kanon/KAN/KAN-1",
    revision_count: 0,
    duplicate_count: 0,
    last_seen_at: "2026-01-15T10:00:00Z",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeSyncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    engramId: 100,
    topicKey: "kanon/KAN/KAN-1",
    syncedAt: "2026-01-15T10:00:00Z",
    contentHash:
      "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    engramRevision: 0,
    direction: "exported",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SyncableIssue> = {}): SyncableIssue {
  return {
    key: "KAN-1",
    title: "Test Issue",
    type: "feature",
    state: "apply",
    priority: "high",
    description: "Some description",
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<SyncEngineConfig> = {},
): SyncEngineConfig {
  return {
    projectKey: "KAN",
    namespace: "kanon",
    defaultStrategy: "kanon-wins",
    concurrency: 1,
    ...overrides,
  };
}

function createMockEngramClient(): {
  [K in keyof EngramClient]: ReturnType<typeof vi.fn>;
} {
  return {
    health: vi.fn(),
    checkConnectivity: vi.fn(),
    search: vi.fn(),
    getObservation: vi.fn(),
    listRecent: vi.fn(),
    listRecentSince: vi.fn(),
    createObservation: vi.fn(),
    updateObservation: vi.fn(),
  };
}

function createMockKanonClient(): {
  [K in keyof SyncKanonClient]: ReturnType<typeof vi.fn>;
} {
  return {
    createIssue: vi.fn().mockResolvedValue({ key: "KAN-NEW-1" }),
    updateIssue: vi.fn().mockResolvedValue({ key: "KAN-1" }),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("SyncEngine", () => {
  let mockEngram: ReturnType<typeof createMockEngramClient>;
  let mockKanon: ReturnType<typeof createMockKanonClient>;
  let config: SyncEngineConfig;
  let engine: SyncEngine;

  beforeEach(() => {
    mockEngram = createMockEngramClient();
    mockKanon = createMockKanonClient();
    config = makeConfig();
    engine = new SyncEngine(
      mockEngram as unknown as EngramClient,
      mockKanon,
      config,
    );
  });

  // ─── exportToEngram ──────────────────────────────────────────────────

  describe("exportToEngram", () => {
    it("creates a new observation for an issue with no prior sync state", async () => {
      const issue = makeIssue({ engramContext: undefined });
      const createdObs = makeObservation({ id: 200, revision_count: 0 });
      mockEngram.createObservation.mockResolvedValue(createdObs);

      const result = await engine.exportToEngram([issue]);

      expect(mockEngram.createObservation).toHaveBeenCalledOnce();
      const payload = mockEngram.createObservation.mock.calls[0]![0];
      expect(payload.title).toBe("KAN-1: Test Issue");
      expect(payload.project).toBe("kanon");
      expect(payload.scope).toBe("project");
      expect(payload.topic_key).toBe("kanon/KAN/KAN-1");

      expect(result.exported).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        issueKey: "KAN-1",
        action: "create",
        direction: "exported",
        success: true,
      });
    });

    it("updates an existing observation when Kanon content has changed", async () => {
      // Compute a hash for the OLD content so the issue appears dirty
      const oldHash = SyncStateManager.computeHash("Old Title\nOld description");
      const syncState = makeSyncState({
        engramId: 100,
        contentHash: oldHash,
        engramRevision: 0,
      });

      const issue = makeIssue({
        title: "Updated Title",
        description: "New description",
        engramContext: syncState,
      });

      const existingObs = makeObservation({
        id: 100,
        revision_count: 0, // same as syncState.engramRevision — no Engram-side change
      });
      mockEngram.getObservation.mockResolvedValue(existingObs);

      const updatedObs = makeObservation({
        id: 100,
        revision_count: 1,
        title: "KAN-1: Updated Title",
      });
      mockEngram.updateObservation.mockResolvedValue(updatedObs);

      const result = await engine.exportToEngram([issue]);

      expect(mockEngram.updateObservation).toHaveBeenCalledOnce();
      expect(result.exported).toBe(1);
      expect(result.items[0]).toMatchObject({
        issueKey: "KAN-1",
        action: "update",
        direction: "exported",
        success: true,
      });
    });

    it("stamps engramContext on the Kanon issue after successful export", async () => {
      const issue = makeIssue({ engramContext: undefined });
      const createdObs = makeObservation({
        id: 300,
        revision_count: 0,
        topic_key: "kanon/KAN/KAN-1",
      });
      mockEngram.createObservation.mockResolvedValue(createdObs);

      await engine.exportToEngram([issue]);

      // updateIssue should be called to stamp engramContext
      expect(mockKanon.updateIssue).toHaveBeenCalledOnce();
      const [projectKey, issueKey, body] =
        mockKanon.updateIssue.mock.calls[0]!;
      expect(projectKey).toBe("KAN");
      expect(issueKey).toBe("KAN-1");
      expect(body.engramContext).toBeDefined();

      // The stamped state should be parseable
      const stamped = SyncStateManager.parse(body.engramContext);
      expect(stamped).not.toBeNull();
      expect(stamped!.engramId).toBe(300);
      expect(stamped!.direction).toBe("exported");
    });

    it("skips unchanged issues (content hash matches)", async () => {
      // Build content that matches what DiffDetector.buildIssueContent produces
      const issueContent = "Test Issue\nSome description";
      const hash = SyncStateManager.computeHash(issueContent);
      const syncState = makeSyncState({
        engramId: 100,
        contentHash: hash,
        engramRevision: 0,
      });

      const issue = makeIssue({
        title: "Test Issue",
        description: "Some description",
        engramContext: syncState,
      });

      const existingObs = makeObservation({
        id: 100,
        revision_count: 0, // matches syncState.engramRevision
      });
      mockEngram.getObservation.mockResolvedValue(existingObs);

      const result = await engine.exportToEngram([issue]);

      expect(mockEngram.createObservation).not.toHaveBeenCalled();
      expect(mockEngram.updateObservation).not.toHaveBeenCalled();
      expect(result.exported).toBe(0);
      expect(result.unchanged).toBeGreaterThan(0);
      expect(result.items).toHaveLength(0);
    });

    it("returns correct SyncResult shape with multiple issues", async () => {
      const issue1 = makeIssue({ key: "KAN-1", engramContext: undefined });
      const issue2 = makeIssue({ key: "KAN-2", engramContext: undefined });
      const issue3 = makeIssue({ key: "KAN-3", engramContext: undefined });

      mockEngram.createObservation
        .mockResolvedValueOnce(makeObservation({ id: 201 }))
        .mockResolvedValueOnce(makeObservation({ id: 202 }))
        .mockResolvedValueOnce(makeObservation({ id: 203 }));

      const result = await engine.exportToEngram([issue1, issue2, issue3]);

      expect(result.exported).toBe(3);
      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.items).toHaveLength(3);
      expect(result.items.every((i) => i.success)).toBe(true);
    });

    it("supports dryRun mode — no mutations", async () => {
      const issue = makeIssue({ engramContext: undefined });

      const result = await engine.exportToEngram([issue], { dryRun: true });

      expect(mockEngram.createObservation).not.toHaveBeenCalled();
      expect(mockEngram.updateObservation).not.toHaveBeenCalled();
      expect(mockKanon.updateIssue).not.toHaveBeenCalled();
      expect(result.exported).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.action).toBe("create");
    });
  });

  // ─── importFromEngram ──────────────────────────────────────────────────

  describe("importFromEngram", () => {
    it("updates a Kanon issue when Engram observation has new revisions", async () => {
      const syncState = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        engramRevision: 0,
      });

      const issue = makeIssue({ engramContext: syncState });

      const observation = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 1, // bumped — indicates Engram-side change
        content: "Updated content from Engram",
      });

      const result = await engine.importFromEngram([issue], [observation]);

      // Should update Kanon issue with Engram content
      expect(mockKanon.updateIssue).toHaveBeenCalled();
      const updateCalls = mockKanon.updateIssue.mock.calls;

      // First call: update issue description
      expect(updateCalls[0]![0]).toBe("KAN");
      expect(updateCalls[0]![1]).toBe("KAN-1");
      expect(updateCalls[0]![2]).toMatchObject({
        description: "Updated content from Engram",
      });

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.items[0]!).toMatchObject({
        issueKey: "KAN-1",
        action: "update",
        direction: "imported",
        success: true,
      });
    });

    it("skips observations without a topic_key", async () => {
      const observation = makeObservation({ topic_key: undefined });
      const result = await engine.importFromEngram([], [observation]);

      expect(mockKanon.updateIssue).not.toHaveBeenCalled();
      expect(result.imported).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("creates a new Kanon issue for observations with no matching issue", async () => {
      const observation = makeObservation({
        id: 500,
        topic_key: "kanon/KAN/KAN-99",
        revision_count: 0,
      });

      // No matching issue — this should create a new issue
      const result = await engine.importFromEngram([], [observation]);

      // createIssue should have been called with observation data
      expect(mockKanon.createIssue).toHaveBeenCalledOnce();
      const [projectKey, payload] = mockKanon.createIssue.mock.calls[0]!;
      expect(projectKey).toBe("KAN");
      expect(payload.title).toBe(observation.title);
      expect(payload.description).toBe(observation.content);
      expect(payload.type).toBe("task");
      expect(payload.priority).toBe("medium");

      // updateIssue should have been called to stamp engramContext
      expect(mockKanon.updateIssue).toHaveBeenCalledOnce();
      const [, issueKey, body] = mockKanon.updateIssue.mock.calls[0]!;
      expect(issueKey).toBe("KAN-NEW-1");
      expect(body.engramContext).toBeDefined();

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        issueKey: "KAN-NEW-1",
        action: "create",
        direction: "imported",
        success: true,
      });
    });

    it("skips observations whose revision_count has not changed", async () => {
      const syncState = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        engramRevision: 2,
      });

      const issue = makeIssue({ engramContext: syncState });

      const observation = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 2, // same as syncState.engramRevision — no change
      });

      const result = await engine.importFromEngram([issue], [observation]);

      expect(result.imported).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("supports dryRun mode — no mutations", async () => {
      const syncState = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        engramRevision: 0,
      });

      const issue = makeIssue({ engramContext: syncState });

      const observation = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 1,
      });

      const result = await engine.importFromEngram([issue], [observation], {
        dryRun: true,
      });

      expect(mockKanon.updateIssue).not.toHaveBeenCalled();
      expect(result.imported).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });

  // ─── sync (bidirectional) ────────────────────────────────────────────

  describe("sync (bidirectional)", () => {
    it("runs export then import and merges results", async () => {
      // Issue with no sync state — will be exported (create)
      const issue1 = makeIssue({
        key: "KAN-1",
        title: "Export Me",
        engramContext: undefined,
      });

      // Issue with sync state whose content hash matches current content
      // so it is "unchanged" on Kanon side. Paired with a changed observation
      // for import (revision bumped).
      const issue2Content = "Import Target\nSome description";
      const issue2Hash = SyncStateManager.computeHash(issue2Content);
      const syncState = makeSyncState({
        engramId: 200,
        topicKey: "kanon/KAN/KAN-2",
        contentHash: issue2Hash,
        engramRevision: 0,
      });
      const issue2 = makeIssue({
        key: "KAN-2",
        title: "Import Target",
        description: "Some description",
        engramContext: syncState,
      });

      // Export phase: issue1 is new → create observation
      const exportObs = makeObservation({ id: 201, revision_count: 0 });
      mockEngram.createObservation.mockResolvedValue(exportObs);

      // Export phase: getObservation for issue2's sync state — same revision
      // so issue2 stays "unchanged" on export side
      mockEngram.getObservation.mockResolvedValue(
        makeObservation({ id: 200, revision_count: 0 }),
      );

      // Observation that triggers import (revision bumped from 0 to 1)
      const importObs = makeObservation({
        id: 200,
        topic_key: "kanon/KAN/KAN-2",
        revision_count: 1,
        content: "Updated from Engram",
      });

      const result = await engine.sync(
        [issue1, issue2],
        [importObs],
      );

      // Export: issue1 exported (new), issue2 unchanged
      expect(result.exported).toBe(1);
      // Import: importObs has revision_count 1 vs syncState engramRevision 0
      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);
      // Items should contain both export and import entries
      expect(result.items.length).toBe(2);
      expect(result.items.some((i) => i.direction === "exported")).toBe(true);
      expect(result.items.some((i) => i.direction === "imported")).toBe(true);
    });

    it("returns combined error arrays from both directions", async () => {
      const issue = makeIssue({ key: "KAN-1", engramContext: undefined });
      mockEngram.createObservation.mockRejectedValue(
        new Error("Engram down"),
      );

      const syncState = makeSyncState({
        engramId: 300,
        topicKey: "kanon/KAN/KAN-3",
        engramRevision: 0,
      });
      const issue2 = makeIssue({
        key: "KAN-3",
        engramContext: syncState,
      });

      const observation = makeObservation({
        id: 300,
        topic_key: "kanon/KAN/KAN-3",
        revision_count: 1,
      });

      // For the export phase — getObservation for issue2's sync state
      mockEngram.getObservation.mockResolvedValue(
        makeObservation({ id: 300, revision_count: 1 }),
      );

      // Fail the import update too
      mockKanon.updateIssue.mockRejectedValue(new Error("Kanon API error"));

      const result = await engine.sync([issue, issue2], [observation]);

      // Both export and import should have errors
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Partial Failure Handling (R-SYNC-10) ────────────────────────────

  describe("partial failure handling (R-SYNC-10)", () => {
    it("continues processing remaining items when one export fails", async () => {
      const issue1 = makeIssue({ key: "KAN-1", engramContext: undefined });
      const issue2 = makeIssue({ key: "KAN-2", engramContext: undefined });
      const issue3 = makeIssue({ key: "KAN-3", engramContext: undefined });

      mockEngram.createObservation
        .mockResolvedValueOnce(makeObservation({ id: 201 }))
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce(makeObservation({ id: 203 }));

      const result = await engine.exportToEngram([issue1, issue2, issue3]);

      // Two succeed, one fails
      expect(result.exported).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.item).toBe("KAN-2");
      expect(result.errors[0]!.error).toBe("Network timeout");
      expect(result.items).toHaveLength(3);

      const successes = result.items.filter((i) => i.success);
      const failures = result.items.filter((i) => !i.success);
      expect(successes).toHaveLength(2);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.issueKey).toBe("KAN-2");
      expect(failures[0]!.error).toBe("Network timeout");
    });

    it("continues processing remaining items when one import fails", async () => {
      const syncState1 = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        engramRevision: 0,
      });
      const syncState2 = makeSyncState({
        engramId: 200,
        topicKey: "kanon/KAN/KAN-2",
        engramRevision: 0,
      });

      const issue1 = makeIssue({ key: "KAN-1", engramContext: syncState1 });
      const issue2 = makeIssue({ key: "KAN-2", engramContext: syncState2 });

      const obs1 = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 1,
        content: "Updated 1",
      });
      const obs2 = makeObservation({
        id: 200,
        topic_key: "kanon/KAN/KAN-2",
        revision_count: 1,
        content: "Updated 2",
      });

      // First import succeeds, second fails
      mockKanon.updateIssue
        .mockResolvedValueOnce({ key: "KAN-1" }) // description update
        .mockResolvedValueOnce({ key: "KAN-1" }) // stamp engramContext
        .mockRejectedValueOnce(new Error("DB connection lost")); // issue2 description update fails

      const result = await engine.importFromEngram(
        [issue1, issue2],
        [obs1, obs2],
      );

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("DB connection lost");
      expect(result.items).toHaveLength(2);
    });

    it("collects error messages from non-Error throwables", async () => {
      const issue = makeIssue({ engramContext: undefined });

      mockEngram.createObservation.mockRejectedValue("string error");

      const result = await engine.exportToEngram([issue]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("string error");
    });
  });

  // ─── Idempotency (R-SYNC-12) ─────────────────────────────────────────

  describe("idempotency (R-SYNC-12)", () => {
    it("export is no-op when content has not changed since last sync", async () => {
      const issue = makeIssue({
        title: "Stable Issue",
        description: "No changes here",
      });

      // Compute hash matching what DiffDetector.buildIssueContent produces
      const issueContent = "Stable Issue\nNo changes here";
      const hash = SyncStateManager.computeHash(issueContent);

      const syncState = makeSyncState({
        engramId: 100,
        contentHash: hash,
        engramRevision: 0,
      });
      issue.engramContext = syncState;

      const existingObs = makeObservation({
        id: 100,
        revision_count: 0,
      });
      mockEngram.getObservation.mockResolvedValue(existingObs);

      // First call
      const result1 = await engine.exportToEngram([issue]);

      expect(result1.exported).toBe(0);
      expect(result1.unchanged).toBeGreaterThan(0);
      expect(mockEngram.createObservation).not.toHaveBeenCalled();
      expect(mockEngram.updateObservation).not.toHaveBeenCalled();

      // Second call — should be identical
      const result2 = await engine.exportToEngram([issue]);

      expect(result2.exported).toBe(0);
      expect(result2.unchanged).toBeGreaterThan(0);
      expect(mockEngram.createObservation).not.toHaveBeenCalled();
      expect(mockEngram.updateObservation).not.toHaveBeenCalled();
    });

    it("import is no-op when observation revision has not changed", async () => {
      const syncState = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        engramRevision: 3,
      });

      const issue = makeIssue({ engramContext: syncState });

      const observation = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 3, // matches — no change
      });

      const result1 = await engine.importFromEngram([issue], [observation]);
      const result2 = await engine.importFromEngram([issue], [observation]);

      expect(result1.imported).toBe(0);
      expect(result2.imported).toBe(0);
      expect(result1.items).toHaveLength(0);
      expect(result2.items).toHaveLength(0);
      expect(mockKanon.updateIssue).not.toHaveBeenCalled();
    });

    it("running full sync twice with no changes produces no-op", async () => {
      const issueContent = "Idempotent Issue\nStable content";
      const hash = SyncStateManager.computeHash(issueContent);

      const syncState = makeSyncState({
        engramId: 100,
        topicKey: "kanon/KAN/KAN-1",
        contentHash: hash,
        engramRevision: 5,
      });

      const issue = makeIssue({
        title: "Idempotent Issue",
        description: "Stable content",
        engramContext: syncState,
      });

      const observation = makeObservation({
        id: 100,
        topic_key: "kanon/KAN/KAN-1",
        revision_count: 5,
      });

      mockEngram.getObservation.mockResolvedValue(observation);

      const result1 = await engine.sync([issue], [observation]);
      const result2 = await engine.sync([issue], [observation]);

      expect(result1.exported).toBe(0);
      expect(result1.imported).toBe(0);
      expect(result2.exported).toBe(0);
      expect(result2.imported).toBe(0);
      expect(result1.errors).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);
      expect(mockEngram.createObservation).not.toHaveBeenCalled();
      expect(mockEngram.updateObservation).not.toHaveBeenCalled();
    });
  });

  // ─── Progress Callback ──────────────────────────────────────────────

  describe("progress callback", () => {
    it("calls onProgress for each exported item", async () => {
      const onProgress = vi.fn();
      const engineWithProgress = new SyncEngine(
        mockEngram as unknown as EngramClient,
        mockKanon,
        makeConfig({ onProgress }),
      );

      const issue1 = makeIssue({ key: "KAN-1", engramContext: undefined });
      const issue2 = makeIssue({ key: "KAN-2", engramContext: undefined });

      mockEngram.createObservation
        .mockResolvedValueOnce(makeObservation({ id: 201 }))
        .mockResolvedValueOnce(makeObservation({ id: 202 }));

      await engineWithProgress.exportToEngram([issue1, issue2]);

      expect(onProgress).toHaveBeenCalledTimes(2);
      // With concurrency 1, progress should be sequential
      expect(onProgress).toHaveBeenCalledWith(1, 2, "KAN-1");
      expect(onProgress).toHaveBeenCalledWith(2, 2, "KAN-2");
    });
  });
});
