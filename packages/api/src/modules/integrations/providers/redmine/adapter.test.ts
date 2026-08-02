import { describe, expect, it, vi } from "vitest";
import type {
  CanonicalCycle,
  CanonicalIssue,
  CanonicalIssuePatch,
  CanonicalProject,
  PmProviderAdapter,
} from "../../core/types.js";
import { RedmineProviderAdapter } from "./adapter.js";
import { RedmineHttpError } from "./http-client.js";

const project: CanonicalProject = {
  id: "project-1",
  key: "ARB",
  name: "Árbol API",
  description: "Internal API",
};
const cycle: CanonicalCycle = {
  id: "cycle-1",
  projectId: project.id,
  name: "Sprint 1",
  startDate: new Date("2026-07-01T00:00:00.000Z"),
  endDate: new Date("2026-07-14T00:00:00.000Z"),
};
const issue: CanonicalIssue = {
  id: "issue-1",
  key: "ARB-1",
  projectId: project.id,
  cycleId: cycle.id,
  title: "Ship adapter",
  description: "Details",
  status: "in_progress",
  assignee: { id: "user-1", displayName: "Ada" },
  estimateHours: 2.5,
  startDate: cycle.startDate,
  dueDate: cycle.endDate,
  progress: 50,
};
const omit = { kind: "omit" } as const;
const noChange: CanonicalIssuePatch = {
  title: omit,
  description: omit,
  status: omit,
  assignee: omit,
  estimateHours: omit,
  startDate: omit,
  dueDate: omit,
  progress: omit,
  cycleId: omit,
};

function client() {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn() };
}

describe("RedmineProviderAdapter", () => {
  it("discovers projects, statuses, cycles, trackers, and the authenticated user", async () => {
    const http = client();
    http.get.mockImplementation((path: string) => {
      if (path === "/projects.json?limit=100") {
        return { projects: [{ id: 4, name: "Project" }] };
      }
      if (path === "/issue_statuses.json") {
        return { issue_statuses: [{ id: 2, name: "New" }] };
      }
      if (path === "/projects/4/versions.json") {
        return { versions: [{ id: 3, name: "Sprint", due_date: "2026-07-14" }] };
      }
      if (path === "/trackers.json") return { trackers: [{ id: 1, name: "Bug" }] };
      return { user: { id: 8, firstname: "Ada", lastname: "Lovelace", login: "ada" } };
    });
    const adapter: PmProviderAdapter & { listTrackers(): Promise<unknown> } =
      new RedmineProviderAdapter(http, { writeMap: {}, resolveExternalId: vi.fn() });

    await expect(adapter.capabilities()).resolves.toEqual({
      canCreateProjects: true,
      canCreateCycles: true,
      canCreateIssues: true,
    });
    await expect(adapter.listProjects()).resolves.toEqual([{ id: "4", name: "Project" }]);
    await expect(adapter.listStatuses()).resolves.toEqual([
      { id: "2", name: "New", writable: true },
    ]);
    await expect(adapter.listCycles("4")).resolves.toEqual([
      { id: "3", name: "Sprint", startDate: null, endDate: new Date("2026-07-14") },
    ]);
    await expect(adapter.listTrackers()).resolves.toEqual([{ id: "1", name: "Bug" }]);
    await expect(adapter.whoAmI()).resolves.toEqual({
      id: "8",
      displayName: "Ada Lovelace",
      login: "ada",
    });
  });

  it("creates projects from the full-name identifier and cycles as Redmine versions", async () => {
    const http = client();
    http.get.mockResolvedValueOnce({ projects: [] }).mockResolvedValueOnce({ versions: [] });
    http.post
      .mockResolvedValueOnce({ project: { id: 41, updated_on: "2026-07-01T10:00:00Z" } })
      .mockResolvedValueOnce({ version: { id: 12, updated_on: "2026-07-02T10:00:00Z" } });
    let projectCreated = false;
    const resolveExternalId = vi.fn(async (type: string) =>
      type === "project" && projectCreated ? "41" : null
    );
    const adapter = new RedmineProviderAdapter(http, { writeMap: {}, resolveExternalId });

    await expect(adapter.ensureProject(project)).resolves.toMatchObject({ externalId: "41" });
    projectCreated = true;
    expect(http.post).toHaveBeenNthCalledWith(1, "/projects.json", {
      project: {
        name: "Árbol API",
        identifier: "arbol-api",
        description: "Internal API",
        is_public: false,
      },
    });

    await expect(adapter.ensureCycle(cycle)).resolves.toMatchObject({ externalId: "12" });
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenNthCalledWith(2, "/projects/41/versions.json", {
      version: expect.objectContaining({ name: "Sprint 1", due_date: "2026-07-14" }),
    });
  });

  it("returns known project and cycle refs without provider I/O", async () => {
    const http = client();
    http.get.mockRejectedValue(new Error("request timed out"));
    http.post.mockRejectedValue(new Error("request timed out"));
    const resolveExternalId = vi.fn(async (type: string) =>
      type === "project" ? "41" : type === "cycle" ? "12" : null
    );
    const adapter = new RedmineProviderAdapter(http, { writeMap: {}, resolveExternalId });

    await expect(adapter.ensureProject(project)).resolves.toMatchObject({ externalId: "41" });
    await expect(adapter.ensureCycle(cycle)).resolves.toMatchObject({ externalId: "12" });

    expect(resolveExternalId).toHaveBeenNthCalledWith(1, "project", project.id);
    expect(resolveExternalId).toHaveBeenNthCalledWith(2, "cycle", cycle.id);
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("creates one marked cycle instead of attaching an unmarked same-name version", async () => {
    const http = client();
    http.get.mockResolvedValue({ versions: [{ id: 9, name: cycle.name }] });
    http.post.mockResolvedValue({ version: { id: 12 } });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: async (type) => (type === "project" ? "41" : null),
    });

    await expect(adapter.ensureCycle(cycle)).resolves.toMatchObject({ externalId: "12" });

    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenCalledOnce();
    expect(http.post).toHaveBeenCalledWith("/projects/41/versions.json", {
      version: expect.objectContaining({
        name: cycle.name,
        description: expect.stringContaining("<!-- kanon-cycle:cycle-1 -->"),
      }),
    });
  });

  it("creates a fully mapped issue with a stable reconciliation marker", async () => {
    const http = client();
    http.post.mockResolvedValue({ issue: { id: 99 } });
    http.get.mockResolvedValue({
      issue: { id: 99, status: { id: 5 }, updated_on: "2026-07-03T10:00:00Z" },
    });
    const ids: Record<string, string> = {
      "project:project-1": "41",
      "cycle:cycle-1": "12",
      "user:user-1": "8",
    };
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: { in_progress: "5" },
      resolveExternalId: async (type, id) => ids[`${type}:${id}`] ?? null,
    });

    await expect(adapter.pushIssue(issue, noChange)).resolves.toEqual({
      externalId: "99",
      requestedStatusId: "5",
      achievedStatusId: "5",
      remoteVersion: "2026-07-03T10:00:00Z",
    });
    expect(http.post).toHaveBeenCalledWith("/issues.json", {
      issue: {
        project_id: "41",
        subject: "Ship adapter",
        description: "Details\n\n<!-- kanon-issue:issue-1 -->",
        status_id: "5",
        assigned_to_id: "8",
        fixed_version_id: "12",
        estimated_hours: 2.5,
        start_date: "2026-07-01",
        due_date: "2026-07-14",
        done_ratio: 50,
      },
    });
  });

  it("clears Redmine assignee and version with empty identifiers", async () => {
    const http = client();
    http.put.mockResolvedValue(undefined);
    http.get.mockResolvedValue({
      issue: { id: 99, status: { id: 5 }, updated_on: "2026-07-03T10:00:00Z" },
    });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: async (type) => (type === "issue" ? "99" : null),
    });
    const clearRelations = {
      ...noChange,
      assignee: { kind: "clear", value: null },
      cycleId: { kind: "clear", value: null },
    } as const;

    await adapter.pushIssue({ ...issue, assignee: null, cycleId: null }, clearRelations);

    expect(http.put).toHaveBeenCalledWith("/issues/99.json", {
      issue: { assigned_to_id: "", fixed_version_id: "" },
    });
  });

  it("reports actual status when Redmine rejects the requested workflow transition", async () => {
    const http = client();
    http.put.mockRejectedValueOnce(new RedmineHttpError(422)).mockResolvedValueOnce(undefined);
    http.get.mockResolvedValue({
      issue: { id: 99, status: { id: 5 }, updated_on: "2026-07-04T10:00:00Z" },
    });
    const warn = vi.fn();
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: { done: "9" },
      resolveExternalId: async (type) => (type === "issue" ? "99" : null),
      warn,
    });
    const statusPatch = { ...noChange, status: { kind: "set", value: "done" } } as const;

    await expect(adapter.pushIssue({ ...issue, status: "done" }, statusPatch)).resolves.toEqual({
      externalId: "99",
      requestedStatusId: "9",
      achievedStatusId: "5",
      remoteVersion: "2026-07-04T10:00:00Z",
    });
    expect(http.put).toHaveBeenCalledTimes(2);
    expect(http.put.mock.calls[0]![1]).toEqual({ issue: { status_id: "9" } });
    expect(http.put.mock.calls[1]![1]).toEqual({ issue: {} });
    expect(warn).toHaveBeenCalledOnce();

    http.put.mockReset().mockRejectedValue(new RedmineHttpError(401));
    await expect(
      adapter.pushIssue({ ...issue, status: "done" }, statusPatch)
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(http.put).toHaveBeenCalledOnce();
  });

  it("rejects a requested status without a Redmine mapping", async () => {
    const http = client();
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: async (type) => (type === "issue" ? "99" : null),
    });
    const statusPatch = { ...noChange, status: { kind: "set", value: "done" } } as const;

    await expect(adapter.pushIssue({ ...issue, status: "done" }, statusPatch)).rejects.toThrow(
      "Missing Redmine status mapping for done"
    );
    expect(http.put).not.toHaveBeenCalled();
  });

  it("exhaustively reconciles exact issue markers with stable closed-issue pagination", async () => {
    const http = client();
    http.get.mockImplementation((path: string) => {
      if (path.endsWith("offset=0")) {
        return {
          total_count: 4,
          offset: 0,
          limit: 2,
          issues: [
            {
              id: 10,
              description: "<!-- kanon-issue:issue-1 -->",
              status: { id: 5 },
              updated_on: "2026-07-03T10:00:00Z",
            },
            { id: 11, description: "<!-- kanon-issue:issue-10 -->" },
          ],
        };
      }
      return {
        total_count: 4,
        offset: 2,
        limit: 2,
          issues: [
          { id: 12, description: "No marker" },
          { id: 13, description: "No marker" },
        ],
      };
    });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: vi.fn(),
    });

    await expect(
      adapter.reconcileCreate({
        entityType: "issue",
        entityId: "issue-1",
        remoteProjectId: "remote/project",
      }),
    ).resolves.toEqual([
      {
        externalId: "10",
        requestedStatusId: null,
        achievedStatusId: "5",
        remoteVersion: "2026-07-03T10:00:00Z",
      },
    ]);
    expect(http.get.mock.calls.map(([path]) => path)).toEqual([
      "/issues.json?project_id=remote%2Fproject&status_id=*&sort=id%3Aasc&limit=100&offset=0",
      "/issues.json?project_id=remote%2Fproject&status_id=*&sort=id%3Aasc&limit=100&offset=2",
    ]);
  });

  it("constrains exact cycle-marker reconciliation to the bound remote project", async () => {
    const http = client();
    http.get.mockResolvedValue({
      versions: [
        { id: 12, status: "open", description: "<!-- kanon-cycle:cycle-1 -->", updated_on: "version-1" },
        { id: 12, status: "open", description: "<!-- kanon-cycle:cycle-1 -->", updated_on: "version-1" },
        { id: 13, description: "<!-- kanon-cycle:cycle-10 -->" },
      ],
    });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: vi.fn(),
    });

    await expect(
      adapter.reconcileCreate({
        entityType: "cycle",
        entityId: "cycle-1",
        remoteProjectId: "project 41",
      }),
    ).resolves.toEqual([
      {
        externalId: "12",
        requestedStatusId: null,
        achievedStatusId: null,
        remoteVersion: "version-1",
      },
    ]);
    expect(http.get).toHaveBeenCalledWith("/projects/project%2041/versions.json");
  });

  it("rejects marker-bearing cycles without a positive numeric remote ID", async () => {
    for (const version of [{}, { id: 0 }, { id: "not-a-number" }]) {
      const http = client();
      http.get.mockResolvedValue({
        versions: [{ ...version, description: "<!-- kanon-cycle:cycle-1 -->" }],
      });
      const adapter = new RedmineProviderAdapter(http, {
        writeMap: {},
        resolveExternalId: vi.fn(),
      });

      await expect(
        adapter.reconcileCreate({
          entityType: "cycle",
          entityId: "cycle-1",
          remoteProjectId: "41",
        }),
      ).rejects.toThrow(/version/i);
    }
  });

  it("rejects malformed or non-advancing issue pagination", async () => {
    for (const response of [
      { total_count: 1, offset: 0, limit: 0, issues: [] },
      { total_count: 101, offset: 0, limit: 100, issues: [] },
    ]) {
      const http = client();
      http.get.mockResolvedValue(response);
      const adapter = new RedmineProviderAdapter(http, {
        writeMap: {},
        resolveExternalId: vi.fn(),
      });

      await expect(
        adapter.reconcileCreate({
          entityType: "issue",
          entityId: "issue-1",
          remoteProjectId: "41",
        }),
      ).rejects.toThrow(/pagination/i);
    }
  });

  it("rejects issue pagination when total or page limit changes", async () => {
    for (const secondPage of [
      { total_count: 4, offset: 2, limit: 1, issues: [{ id: 3 }, { id: 4 }] },
      { total_count: 5, offset: 2, limit: 2, issues: [{ id: 3 }, { id: 4 }] },
    ]) {
      const http = client();
      http.get
        .mockResolvedValueOnce({
          total_count: 4,
          offset: 0,
          limit: 2,
          issues: [{ id: 1 }, { id: 2 }],
        })
        .mockResolvedValueOnce(secondPage);
      const adapter = new RedmineProviderAdapter(http, {
        writeMap: {},
        resolveExternalId: vi.fn(),
      });

      await expect(
        adapter.reconcileCreate({
          entityType: "issue",
          entityId: "issue-1",
          remoteProjectId: "41",
        }),
      ).rejects.toThrow(/pagination/i);
    }
  });

  it("rejects a short non-final issue page", async () => {
    const http = client();
    http.get.mockResolvedValue({
      total_count: 4,
      offset: 0,
      limit: 2,
      issues: [{ id: 1 }],
    });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: vi.fn(),
    });

    await expect(
      adapter.reconcileCreate({
        entityType: "issue",
        entityId: "issue-1",
        remoteProjectId: "41",
      }),
    ).rejects.toThrow(/pagination/i);
  });

  it("rejects missing, non-numeric, non-positive, or non-ascending issue IDs", async () => {
    for (const issues of [
      [{ description: "missing" }],
      [{ id: "not-a-number" }],
      [{ id: 0 }],
      [{ id: 2 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }],
    ]) {
      const http = client();
      http.get.mockResolvedValue({ total_count: issues.length, offset: 0, limit: 100, issues });
      const adapter = new RedmineProviderAdapter(http, {
        writeMap: {},
        resolveExternalId: vi.fn(),
      });

      await expect(
        adapter.reconcileCreate({
          entityType: "issue",
          entityId: "issue-1",
          remoteProjectId: "41",
        }),
      ).rejects.toThrow(/pagination/i);
    }
  });

  it("rejects issue reconciliation totals beyond the three-page cap", async () => {
    const http = client();
    http.get.mockResolvedValue({ total_count: 301, offset: 0, limit: 100, issues: [] });
    const adapter = new RedmineProviderAdapter(http, {
      writeMap: {},
      resolveExternalId: vi.fn(),
    });

    await expect(
      adapter.reconcileCreate({
        entityType: "issue",
        entityId: "issue-1",
        remoteProjectId: "41",
      }),
    ).rejects.toThrow(/pagination/i);
    expect(http.get).toHaveBeenCalledOnce();
    expect(http.post).not.toHaveBeenCalled();
  });
});
