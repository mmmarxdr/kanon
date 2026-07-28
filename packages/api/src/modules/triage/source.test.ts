import { describe, expect, it } from "vitest";
import { createSourceIdentity, sourceHash, sourceVersion } from "./source.js";

const snapshot = {
  workspaceId: "w1",
  projectId: "p1",
  issueId: "i1",
  issueKey: "KAN-1",
  projectKey: "KAN",
  title: "ＡＰＩ Ｔriage",
  description: "private detail",
  type: "bug",
  priority: "high",
  state: "started",
  labels: ["triage", "triage"],
  groupId: null,
  assigneeId: "u1",
  cycleId: null,
  parentId: null,
  issueUpdatedAt: "2025-01-01T00:00:00.000Z",
  projectUpdatedAt: "2025-01-02T00:00:00.000Z",
} as const;

describe("triage source identity", () => {
  it("derives a stable opaque version from issue and project revisions", () => {
    const version = sourceVersion(snapshot.issueUpdatedAt, snapshot.projectUpdatedAt);
    expect(version).toMatch(/^isv1\.[A-Za-z0-9_-]+$/);
    expect(version).toBe(sourceVersion(new Date(snapshot.issueUpdatedAt), new Date(snapshot.projectUpdatedAt)));
    expect(version).not.toBe(sourceVersion(snapshot.issueUpdatedAt, "2025-01-03T00:00:00.000Z"));
  });

  it("hashes the canonical represented source without exposing description bytes", () => {
    const identity = createSourceIdentity(snapshot);
    expect(identity.sourceHash).toBe(sourceHash(snapshot));
    expect(identity.canonicalSource).not.toHaveProperty("description");
    expect(identity.canonicalSource.descriptionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.canonicalSource.labels).toEqual(["triage"]);
  });

  it("changes when any represented source field changes", () => {
    const fields = ["workspaceId", "projectId", "issueId", "issueKey", "projectKey", "title", "type", "priority", "state", "groupId", "assigneeId", "cycleId", "parentId"] as const;
    for (const field of fields) {
      const changed = { ...snapshot, [field]: `${snapshot[field]}-changed` };
      expect(sourceHash(changed)).not.toBe(sourceHash(snapshot));
    }
    expect(sourceHash({ ...snapshot, description: "changed" })).not.toBe(sourceHash(snapshot));
    expect(sourceHash({ ...snapshot, labels: ["other"] })).not.toBe(sourceHash(snapshot));
    expect(sourceHash({ ...snapshot, issueUpdatedAt: "2025-01-04T00:00:00.000Z" })).not.toBe(sourceHash(snapshot));
    expect(() => sourceVersion("not-a-date", snapshot.projectUpdatedAt)).toThrow(/date/);
  });
});
