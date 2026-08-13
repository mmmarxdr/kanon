import { describe, expect, it } from "vitest";
import {
  isCompleteCurrentVisibleCensus,
  runRedmineAuditCensus,
  type AuditCensusLease,
  type AuditCensusPersistence,
  type AuditCensusSource,
} from "./audit.js";

const lease: AuditCensusLease = {
  bindingId: "binding-1", leaseToken: "lease-1", fence: 7, scopeFingerprint: "scope-1",
};
const changedAt = new Date("2026-08-04T10:30:00Z");

function source(passes: readonly (readonly string[])[]): AuditCensusSource {
  let page = 0;
  return {
    async readPage() {
      const ids = passes[page++] ?? [];
      return {
        kind: "accepted",
        providerObservedAt: new Date("2026-08-04T10:30:00Z"),
        value: {
          changes: ids.map((id) => ({ identity: { remoteId: id }, changedAt })),
          nextCheckpoint: ids.length ? { updatedAt: changedAt, remoteId: ids.at(-1)!, pageToken: null } : null,
          hasMore: false,
        },
      };
    },
    async readIssueDetail(issueId) {
      return {
        kind: "accepted",
        providerObservedAt: new Date("2026-08-04T10:30:00Z"),
        value: { issue: { identity: { remoteId: issueId }, changedAt }, comments: [], journalIds: [] },
      };
    },
  };
}

function persistence(options: { readonly current?: readonly boolean[]; readonly commits?: readonly boolean[]; readonly finish?: boolean } = {}) {
  let current = 0;
  let commits = 0;
  const committed: unknown[] = [];
  const result: AuditCensusPersistence = {
    async isLeaseCurrent() { return options.current?.[current++] ?? true; },
    async commitIssue(input) { committed.push(input); return options.commits?.[commits++] ?? true; },
    async finish() { return options.finish ?? true; },
  };
  return { result, committed };
}

describe("runRedmineAuditCensus", () => {
  it("commits each detail observation with its checkpoint and completes only after unchanged visible passes converge", async () => {
    const store = persistence();
    const result = await runRedmineAuditCensus(source([["42"], ["42"]]), store.result, lease, { maxPasses: 2, pageSize: 10 });

    expect(result).toEqual({ kind: "complete-current-visible", scopeFingerprint: "scope-1" });
    expect(store.committed).toHaveLength(2);
    expect(store.committed[0]).toMatchObject({
      lease, checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 1, lastIssueId: "42" },
      observations: [{ identityType: "issue", remoteId: "42" }],
    });
    expect("absence" in result).toBe(false);
  });

  it("advances a multi-item page checkpoint only through the detail committed in that transaction", async () => {
    const store = persistence();
    const result = await runRedmineAuditCensus(source([["42", "43"], ["42", "43"]]), store.result, lease, { maxPasses: 2, pageSize: 10 });

    expect(result).toEqual({ kind: "complete-current-visible", scopeFingerprint: "scope-1" });
    expect(store.committed).toHaveLength(4);
    expect(store.committed[0]).toMatchObject({
      observations: [{ identityType: "issue", remoteId: "42" }],
      checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 2, lastIssueUpdatedAt: changedAt, lastIssueId: "42" },
    });
    expect(store.committed[1]).toMatchObject({
      observations: [{ identityType: "issue", remoteId: "43" }],
      checkpoint: { pass: 0, offset: 0, itemIndex: 1, expectedTotal: 2, lastIssueUpdatedAt: changedAt, lastIssueId: "43" },
    });
  });

  it("replays from the first uncommitted detail after a multi-item page commit fails", async () => {
    const store = persistence({ commits: [true, false, true, true, true, true] });

    await expect(runRedmineAuditCensus(source([["42", "43"]]), store.result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "unknown", reasonCode: "scope_or_fence_changed" });
    await expect(runRedmineAuditCensus(source([["42", "43"], ["42", "43"]]), store.result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "complete-current-visible", scopeFingerprint: "scope-1" });

    expect(store.committed).toHaveLength(6);
    expect(store.committed[0]).toMatchObject({ checkpoint: { pass: 0, offset: 0, itemIndex: 0, lastIssueId: "42" } });
    expect(store.committed[1]).toMatchObject({ checkpoint: { pass: 0, offset: 0, itemIndex: 1, lastIssueId: "43" } });
    expect(store.committed[2]).toMatchObject({ checkpoint: { pass: 0, offset: 0, itemIndex: 0, lastIssueId: "42" } });
  });

  it("fails closed without completing when its shared poll fence is lost or scope/credential/configuration drift invalidates the lease", async () => {
    const store = persistence({ current: [true, false] });
    const result = await runRedmineAuditCensus(source([["42"]]), store.result, lease, { maxPasses: 2, pageSize: 10 });

    expect(result).toEqual({ kind: "unknown", reasonCode: "scope_or_fence_changed" });
    expect(store.committed).toHaveLength(0);
  });

  it("treats a rejected fenced atomic checkpoint commit as unknown so crash replay can retry inclusively", async () => {
    const store = persistence({ commits: [false, true, true] });
    const result = await runRedmineAuditCensus(source([["42"], ["42"]]), store.result, lease, { maxPasses: 2, pageSize: 10 });

    expect(result).toEqual({ kind: "unknown", reasonCode: "scope_or_fence_changed" });
    const replay = await runRedmineAuditCensus(source([["42"], ["42"]]), store.result, lease, { maxPasses: 2, pageSize: 10 });
    expect(replay).toEqual({ kind: "complete-current-visible", scopeFingerprint: "scope-1" });
    expect(store.committed).toHaveLength(3);
    expect(store.committed[1]).toMatchObject({ observations: [{ identityType: "issue", remoteId: "42" }] });
  });

  it("keeps timeout, detail failure, and incomplete pages non-complete", async () => {
    const timeout: AuditCensusSource = {
      async readPage() { return { kind: "unknown", reasonCode: "timeout" }; },
      async readIssueDetail() { throw new Error("not reached"); },
    };
    const detailFailure: AuditCensusSource = {
      async readPage() { return { kind: "accepted", providerObservedAt: changedAt, value: { changes: [{ identity: { remoteId: "42" }, changedAt }], nextCheckpoint: null, hasMore: false } }; },
      async readIssueDetail() { return { kind: "unknown", reasonCode: "detail_drift" }; },
    };
    const incomplete: AuditCensusSource = {
      async readPage() { return { kind: "accepted", providerObservedAt: changedAt, value: { changes: [], nextCheckpoint: null, hasMore: true } }; },
      async readIssueDetail() { throw new Error("not reached"); },
    };

    await expect(runRedmineAuditCensus(timeout, persistence().result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "unknown", reasonCode: "timeout" });
    await expect(runRedmineAuditCensus(detailFailure, persistence().result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "unknown", reasonCode: "detail_drift" });
    await expect(runRedmineAuditCensus(incomplete, persistence().result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "unknown", reasonCode: "pagination_drift" });
  });

  it("does not let bounded non-convergence become complete", async () => {
    const result = await runRedmineAuditCensus(source([["42"], ["43"]]), persistence().result, lease, { maxPasses: 2, pageSize: 10 });

    expect(result).toEqual({ kind: "unknown", reasonCode: "did_not_converge" });
  });

  it("never treats partial, failed, stale, timeout, or scope-change outcomes as complete", async () => {
    for (const state of ["partial", "failed", "stale"] as const) {
      expect(isCompleteCurrentVisibleCensus({ state, scopeFingerprint: "scope-1", completedAt: changedAt })).toBe(false);
    }
    expect(isCompleteCurrentVisibleCensus({ state: "complete", scopeFingerprint: "scope-1", completedAt: changedAt })).toBe(true);
    const store = persistence({ current: [false] });
    await expect(runRedmineAuditCensus(source([["42"]]), store.result, lease, { maxPasses: 2, pageSize: 10 }))
      .resolves.toEqual({ kind: "unknown", reasonCode: "scope_or_fence_changed" });
  });
});
