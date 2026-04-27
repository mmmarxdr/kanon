import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { cycleKeys, issueKeys } from "./query-keys";
import type { IssueDetail } from "@/types/issue";

// We import the module under test dynamically so the RED phase (missing file)
// gives an import error rather than a misleading type error.
// After B1.2, the dynamic import resolves and tests go GREEN.

const CYCLE_ID = "cycle-abc";
const ISSUE_KEY = "TEST-1";
const PROJECT_KEY = "TEST";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeIssueDetail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: "issue-id-1",
    key: ISSUE_KEY,
    title: "Test Issue",
    type: "task",
    priority: "medium",
    state: "todo",
    labels: [],
    projectId: "proj-1",
    project: { id: "proj-1", key: PROJECT_KEY, name: "Test Project" },
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    cycle: null,
    ...overrides,
  };
}

describe("invalidateAfterCycleMembership", () => {
  let queryClient: QueryClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invalidateQueriesSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    queryClient = makeQueryClient();
    invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
  });

  it('context "issue-detail": invalidates NOTHING — optimistic update via setIssueDetailCycle is sufficient', async () => {
    const { invalidateAfterCycleMembership } = await import("./cache-mutations");

    invalidateAfterCycleMembership(queryClient, {
      cycleId: CYCLE_ID,
      issueKey: ISSUE_KEY,
      projectKey: PROJECT_KEY,
      context: "issue-detail",
    });

    // The issue-detail page already updated `cycle` synchronously via setQueryData
    // in onMutate. Cycle keys have no active subscriber on this screen. Issue list
    // is on Board (not mounted here). So nothing should be invalidated.
    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(0);
  });

  it('context "cycles-view": calls invalidateQueries exactly once with cycleKeys.detail(cycleId)', async () => {
    const { invalidateAfterCycleMembership } = await import("./cache-mutations");

    invalidateAfterCycleMembership(queryClient, {
      cycleId: CYCLE_ID,
      issueKey: ISSUE_KEY,
      projectKey: PROJECT_KEY,
      context: "cycles-view",
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: cycleKeys.detail(CYCLE_ID),
    });
    // Must NOT touch these keys
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.detail(ISSUE_KEY) }),
    );
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.list(PROJECT_KEY) }),
    );
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
  });

  it('context "all": calls invalidateQueries exactly 4 times covering all 4 keys', async () => {
    const { invalidateAfterCycleMembership } = await import("./cache-mutations");

    invalidateAfterCycleMembership(queryClient, {
      cycleId: CYCLE_ID,
      issueKey: ISSUE_KEY,
      projectKey: PROJECT_KEY,
      context: "all",
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(4);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: issueKeys.detail(ISSUE_KEY),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: cycleKeys.detail(CYCLE_ID),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: cycleKeys.list(PROJECT_KEY),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: issueKeys.list(PROJECT_KEY),
    });
  });
});

describe("setIssueDetailCycle", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
  });

  it("sets the cycle field without mutating other fields", async () => {
    const { setIssueDetailCycle } = await import("./cache-mutations");
    const original = makeIssueDetail({ cycle: null });
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), original);

    const newCycle = { id: CYCLE_ID, name: "Sprint 1" };
    const previous = setIssueDetailCycle(queryClient, ISSUE_KEY, newCycle);

    expect(previous).toEqual(original);

    const updated = queryClient.getQueryData<IssueDetail>(
      issueKeys.detail(ISSUE_KEY),
    );
    expect(updated?.cycle).toEqual(newCycle);
    // All other fields must be intact
    expect(updated?.id).toBe(original.id);
    expect(updated?.title).toBe(original.title);
    expect(updated?.state).toBe(original.state);
  });

  it("clears the cycle field when called with null", async () => {
    const { setIssueDetailCycle } = await import("./cache-mutations");
    const original = makeIssueDetail({
      cycle: { id: CYCLE_ID, name: "Sprint 1" },
    });
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), original);

    setIssueDetailCycle(queryClient, ISSUE_KEY, null);

    const updated = queryClient.getQueryData<IssueDetail>(
      issueKeys.detail(ISSUE_KEY),
    );
    expect(updated?.cycle).toBeNull();
    // Other fields unchanged
    expect(updated?.title).toBe(original.title);
  });

  it("returns undefined if the cache has no entry for the issue key", async () => {
    const { setIssueDetailCycle } = await import("./cache-mutations");

    const result = setIssueDetailCycle(queryClient, "MISSING-99", {
      id: "c1",
      name: "Cycle",
    });

    expect(result).toBeUndefined();
  });

  it("does not drift on repeated set+clear round-trip", async () => {
    const { setIssueDetailCycle } = await import("./cache-mutations");
    const original = makeIssueDetail({ cycle: null });
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), original);

    setIssueDetailCycle(queryClient, ISSUE_KEY, { id: CYCLE_ID, name: "S1" });
    setIssueDetailCycle(queryClient, ISSUE_KEY, null);

    const after = queryClient.getQueryData<IssueDetail>(
      issueKeys.detail(ISSUE_KEY),
    );
    // Should match original exactly except cycle is explicitly null
    expect(after?.cycle).toBeNull();
    expect(after?.id).toBe(original.id);
    expect(after?.labels).toEqual(original.labels);
  });
});
