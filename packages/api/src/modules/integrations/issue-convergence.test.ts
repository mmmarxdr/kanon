import { describe, expect, it } from "vitest";
import {
  canonicalRedmineDescription,
  issueSyncMetadata,
  readIssueSyncBaseline,
  reconcileIssueSnapshots,
  type IssueSyncSnapshot,
} from "./issue-convergence.js";

const local: IssueSyncSnapshot = {
  title: "Local title",
  description: "Shared body",
  state: "review",
  priority: "high",
  assigneeId: null,
  startDate: "2026-08-03",
  dueDate: null,
  progress: 40,
};

describe("reconcileIssueSnapshots", () => {
  it("classifies remote-only, local-only, equal, converged, and divergent fields", () => {
    const baseline = readIssueSyncBaseline({
      baseline: {
        version: 1,
        sourceVersion: "v1",
        changedAt: "2026-08-01T10:00:00.000Z",
        fields: {
          title: "Base title",
          description: "Shared body",
          state: "review",
          priority: "medium",
          assigneeId: null,
          startDate: "2026-08-01",
          dueDate: null,
          progress: 20,
        },
      },
    });
    const remote = {
      title: "Remote title",
      description: "Shared body",
      state: "done",
      priority: "high",
      assigneeId: null,
      startDate: "2026-08-02",
      dueDate: "2026-08-20",
      progress: 20,
    } as const;

    const result = reconcileIssueSnapshots(baseline, local, remote);

    expect(result.patch).toEqual({ state: "done", dueDate: "2026-08-20" });
    expect(result.appliedFields).toEqual(["state", "dueDate"]);
    expect(result.preservedFields).toEqual(["progress"]);
    expect(result.convergedFields).toEqual(["description", "priority", "assigneeId"]);
    expect(result.conflicts).toMatchObject({
      title: { reason: "diverged" },
      startDate: { reason: "diverged" },
    });
  });

  it("establishes missing baseline only for equal values and keeps mapping failures scoped", () => {
    const result = reconcileIssueSnapshots(null, local, local, { priority: { remoteId: "99" } });

    expect(result.convergedFields).not.toContain("priority");
    expect(result.conflicts).toMatchObject({ priority: { reason: "mapping" } });
    expect(result.conflicts.title).toBeUndefined();
    expect(result.nextBaseline.title).toBe(local.title);
  });
});

describe("issueSyncMetadata", () => {
  it("preserves unrelated metadata and accepts legacy baselines without priority", () => {
    const metadata = issueSyncMetadata(
      {
        custom: "keep",
        baseline: {
          version: 1,
          sourceVersion: "old",
          changedAt: "2026-08-01T10:00:00.000Z",
          fields: { title: "Old title" },
        },
      },
      {
        sourceVersion: "new",
        changedAt: new Date("2026-08-02T10:00:00.000Z"),
        fields: { title: "New title", priority: "high" },
      },
    );

    expect(metadata).toMatchObject({
      custom: "keep",
      remoteVersion: "new",
      baseline: {
        sourceVersion: "new",
        fields: { title: "New title", priority: "high" },
      },
    });
  });
});

describe("canonicalRedmineDescription", () => {
  it("removes only the current issue marker and normalizes an empty body to null", () => {
    const issueId = "11111111-1111-1111-1111-111111111111";

    expect(canonicalRedmineDescription(`Body\n\n<!-- kanon-issue:${issueId} -->`, issueId)).toBe(
      "Body",
    );
    expect(canonicalRedmineDescription(`<!-- kanon-issue:${issueId} -->`, issueId)).toBeNull();
  });
});
