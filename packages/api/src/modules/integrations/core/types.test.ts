import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CANONICAL_CHANGE_OPERATIONS,
  CANONICAL_ENTITY_TYPES,
  FIELD_VALUE_KINDS,
  REMOTE_ENTITY_TYPES,
  type CanonicalChange,
  type CanonicalComment,
  type CanonicalCycle,
  type CanonicalIssue,
  type CanonicalIssuePatch,
  type CanonicalProject,
  type CanonicalUser,
  type FieldValue,
  type InboundSource,
  isRetryableProviderError,
  type PmProviderAdapter,
  type ProviderCreateReconciler,
  type PushResult,
  type RemoteChange,
  type StatusMaps,
} from "./types.js";

const user = { id: "member-1", displayName: "Ada Lovelace" } satisfies CanonicalUser;
const project = {
  id: "project-1",
  key: "KAN",
  name: "Kanon",
  description: null,
} satisfies CanonicalProject;
const cycle = {
  id: "cycle-1",
  projectId: project.id,
  name: "Sprint 1",
  startDate: new Date("2026-07-20T00:00:00.000Z"),
  endDate: new Date("2026-07-31T00:00:00.000Z"),
} satisfies CanonicalCycle;
const issue = {
  id: "issue-1",
  key: "KAN-182",
  projectId: project.id,
  cycleId: cycle.id,
  title: "Add canonical integration types",
  description: null,
  status: "in_progress",
  assignee: user,
  estimateHours: 2.5,
  startDate: null,
  dueDate: null,
  progress: 50,
} satisfies CanonicalIssue;
const pushResult = {
  externalId: "remote-1",
  requestedStatusId: "remote-in-progress",
  achievedStatusId: "remote-in-progress",
  remoteVersion: "version-7",
} satisfies PushResult;
const comment = {
  id: "comment-1",
  issueId: issue.id,
  body: "Ready for review",
  author: user,
  createdAt: new Date("2026-07-24T12:00:00.000Z"),
} satisfies CanonicalComment;
const noChangePatch: CanonicalIssuePatch = {
  title: { kind: "omit" },
  description: { kind: "omit" },
  status: { kind: "omit" },
  assignee: { kind: "omit" },
  estimateHours: { kind: "omit" },
  startDate: { kind: "omit" },
  dueDate: { kind: "omit" },
  progress: { kind: "omit" },
  cycleId: { kind: "omit" },
};

describe("integrations/core/types", () => {
  it("does not let network heuristics override a definitive HTTP status", () => {
    expect(isRetryableProviderError({ statusCode: 400, name: "TimeoutError", message: "socket timed out" })).toBe(false);
    expect(isRetryableProviderError({ statusCode: 429, message: "rate limited" })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 503, message: "unavailable" })).toBe(true);
  });

  it("models explicit omit, set, and clear field values", () => {
    const values: FieldValue<number>[] = [
      { kind: "omit" },
      { kind: "set", value: 8 },
      { kind: "clear", value: null },
    ];

    expect(FIELD_VALUE_KINDS).toEqual(["omit", "set", "clear"]);
    expect(values.map(({ kind }) => kind)).toEqual(FIELD_VALUE_KINDS);
    expect(values[1]).toEqual({ kind: "set", value: 8 });
    expect(values[2]).toEqual({ kind: "clear", value: null });
  });

  it("exports canonical entities and keeps issue fields provider-neutral", () => {
    expect(CANONICAL_ENTITY_TYPES).toEqual([
      "project",
      "cycle",
      "issue",
      "comment",
      "time_entry",
      "user",
    ]);
    expect(REMOTE_ENTITY_TYPES).toEqual(["issue", "comment"]);
    expect(CANONICAL_CHANGE_OPERATIONS).toEqual([
      "create",
      "update",
      "delete",
      "close",
    ]);
    expect(issue).toMatchObject({
      key: "KAN-182",
      status: "in_progress",
      estimateHours: 2.5,
      progress: 50,
    });
    expect(issue).not.toHaveProperty("redmineId");
    expect(issue).not.toHaveProperty("remoteStatus");
    expect(comment).toMatchObject({ issueId: issue.id, author: user });
  });

  it("types mapped fields and directional status maps explicitly", () => {
    const patch: CanonicalIssuePatch = {
      title: { kind: "set", value: "Updated title" },
      description: { kind: "clear", value: null },
      status: { kind: "omit" },
      assignee: { kind: "clear", value: null },
      estimateHours: { kind: "set", value: 4 },
      startDate: { kind: "set", value: cycle.startDate },
      dueDate: { kind: "clear", value: null },
      progress: { kind: "set", value: 75 },
      cycleId: { kind: "omit" },
    };
    const maps = {
      read: { "remote-new": "backlog", "remote-dev": "in_progress" },
      write: { backlog: "remote-new", in_progress: "remote-dev" },
    } satisfies StatusMaps;

    expect(Object.keys(patch)).toHaveLength(9);
    expect(patch.description).toEqual({ kind: "clear", value: null });
    expect(maps.read["remote-dev"]).toBe("in_progress");
    expect(maps.write.in_progress).toBe("remote-dev");
    expect(maps.write).not.toBe(maps.read);
  });

  it("keeps outbound and inbound ports separate", async () => {
    const adapter: PmProviderAdapter = {
      capabilities: async () => ({
        canCreateProjects: true,
        canCreateCycles: true,
        canCreateIssues: true,
        canReadIssues: true,
        canUpdateIssues: true,
        canReadPublicComments: true,
        canCreatePublicComments: true,
        canMutateComments: false,
        hasDeletionSignals: false,
        hasWebhooks: false,
      }),
      listProjects: async () => [{ id: "remote-project-1", name: project.name }],
      listStatuses: async () => [{ id: "remote-new", name: "New", writable: true }],
       listCycles: async () => [{
         id: "remote-cycle-1",
         name: cycle.name,
         startDate: cycle.startDate,
         endDate: cycle.endDate,
      }],
      whoAmI: async () => ({ id: "remote-user-1", displayName: user.displayName }),
      ensureProject: async () => pushResult,
      ensureCycle: async () => pushResult,
       pushIssue: async () => pushResult,
       reconcileCreate: async () => [pushResult],
     };
    const inbound: InboundSource = {
      poll: async () => ({ changes: [], nextCursor: null, hasMore: false }),
    };

    await expect(adapter.pushIssue(issue, noChangePatch)).resolves.toEqual(pushResult);
    await expect(adapter.listCycles(project.id)).resolves.toEqual([{
      id: "remote-cycle-1",
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    }]);
    await expect(inbound.poll(null)).resolves.toEqual({
      changes: [],
      nextCursor: null,
      hasMore: false,
    });
    expectTypeOf(adapter).toMatchTypeOf<PmProviderAdapter>();
    expectTypeOf(inbound).toMatchTypeOf<InboundSource>();
    expectTypeOf<PmProviderAdapter>().not.toHaveProperty("poll");
    expectTypeOf(adapter).toMatchTypeOf<ProviderCreateReconciler>();
  });

  it("represents inbound changes with opaque identity and version metadata", () => {
    const change = {
      entityType: "issue",
      entityId: "remote-issue-1",
      operation: "update",
      changedAt: new Date("2026-07-24T12:00:00.000Z"),
      remoteVersion: "version-8",
      value: issue,
      correlationId: null,
    } satisfies CanonicalChange;
    const deletedIssue = {
      entityType: "issue",
      entityId: "remote-issue-1",
      operation: "delete",
      changedAt: new Date("2026-07-24T12:00:00.000Z"),
      remoteVersion: "version-8",
      value: null,
      correlationId: null,
    } satisfies CanonicalChange;

    expect(change).toMatchObject({
      entityType: "issue",
      entityId: "remote-issue-1",
      operation: "update",
      remoteVersion: "version-8",
      value: issue,
    });
    expect(deletedIssue.value).toBeNull();
  });

  it("models remote changes before a local entity exists", () => {
    const change = {
      identity: {
        type: "comment",
        remoteId: "journal-9",
        remoteProjectId: "project-7",
        parent: { type: "issue", remoteId: "issue-42" },
      },
      operation: "upsert",
      changedAt: new Date("2026-07-24T12:00:00.000Z"),
      createdAt: new Date("2026-07-24T11:59:00.000Z"),
      sourceVersion: "sha256:version-1",
      actor: { remoteId: "user-5", displayName: "Ada" },
      fields: { body: "Ready" },
    } satisfies RemoteChange;

    expect(change.identity.parent).toEqual({ type: "issue", remoteId: "issue-42" });
    expect(change.fields).toEqual({ body: "Ready" });
  });
});
