import { describe, expect, it } from "vitest";
import { deleteIssueResultSchema, issueDetailSchema } from "./issue.js";

const detail = {
  id: "issue-1",
  key: "KAN-179",
  title: "Delete tickets safely",
  type: "task",
  priority: "critical",
  state: "todo",
  labels: [],
  projectId: "project-1",
  project: { id: "project-1", key: "KAN", name: "Kanon" },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("issue deletion response contract", () => {
  it("parses the server-derived delete capability and Redmine link warning flag", () => {
    expect(
      issueDetailSchema.parse({
        ...detail,
        deleteCapability: { allowed: true, redmineLinked: true },
      }).deleteCapability,
    ).toEqual({ allowed: true, redmineLinked: true });
  });

  it("parses an audited issue deletion result", () => {
    expect(
      deleteIssueResultSchema.parse({
        auditLogId: "audit-1",
        deletedIssueId: "issue-1",
        deletedIssueKey: "KAN-179",
        remoteDeleteQueued: false,
        detachedTimeEntryCount: 2,
      }),
    ).toEqual({
      auditLogId: "audit-1",
      deletedIssueId: "issue-1",
      deletedIssueKey: "KAN-179",
      remoteDeleteQueued: false,
      detachedTimeEntryCount: 2,
    });
  });
});
