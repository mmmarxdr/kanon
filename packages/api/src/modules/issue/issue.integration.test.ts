import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

/**
 * Integration tests for the issue module.
 * Requires a running PostgreSQL database (via docker-compose).
 */
describe("Issue Integration", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberId: string;
  let memberToken: string;
  let projectId: string;
  let projectKey: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await cleanDatabase();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("issue-test");
    workspaceId = ws.id;
    const member = await seedTestMember(workspaceId);
    memberId = member.id;
    memberToken = member.token;
    const project = await seedTestProject(workspaceId, "TST");
    projectId = project.id;
    projectKey = project.key;
  });

  // ── Issue Creation ───────────────────────────────────────────────────

  describe("POST /api/projects/:key/issues", () => {
    it("creates an issue with auto-generated key", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Setup CI",
          type: "task",
          priority: "medium",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.key).toBe(`${projectKey}-1`);
      expect(body.title).toBe("Setup CI");
      expect(body.state).toBe("backlog");
    });

    it("auto-increments issue sequence number", async () => {
      // Create first issue
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Issue 1" },
      });

      // Create second issue
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Issue 2" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().key).toBe(`${projectKey}-2`);
    });

    it("rejects issue creation without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        payload: { title: "No Auth" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── Issue State Transitions ──────────────────────────────────────────

  describe("POST /api/issues/:key/transition", () => {
    let issueKey: string;

    beforeEach(async () => {
      const createRes = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Transition Test", type: "task", priority: "medium" },
      });
      issueKey = createRes.json().key;
    });

    it("allows forward transition and creates activity log", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe("apply");

      // Check activity log was created
      const logs = await prisma.activityLog.findMany({
        where: { issue: { key: issueKey }, action: "state_changed" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const latestLog = logs[logs.length - 1]!;
      const details = latestLog.details as Record<string, unknown>;
      expect(details).toHaveProperty("regression", false);
    });

    it("marks backward transition as regression in activity log", async () => {
      // First move forward
      await app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      // Then move backward
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "explore" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("explore");

      // Check activity log has regression: true
      const logs = await prisma.activityLog.findMany({
        where: { issue: { key: issueKey }, action: "state_changed" },
        orderBy: { createdAt: "desc" },
      });

      const regressionLog = logs[0]!;
      const details = regressionLog.details as Record<string, unknown>;
      expect(details).toHaveProperty("regression", true);
    });

    it("rejects same-state transition", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "backlog" }, // already in backlog
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Issue Filtering ──────────────────────────────────────────────────

  describe("GET /api/projects/:key/issues", () => {
    beforeEach(async () => {
      // Create issues with different states and types
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Bug 1", type: "bug", priority: "high" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Feature 1", type: "feature", priority: "low" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Task 1", type: "task", priority: "medium" },
      });
    });

    it("lists all issues in project", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(3);
    });

    it("filters by type", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues?type=bug`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBe(1);
      expect(body[0].type).toBe("bug");
    });

    it("filters by priority", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues?priority=high`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBe(1);
      expect(body[0].priority).toBe("high");
    });

    it("filters with parent_only=true returns only top-level issues", async () => {
      // The beforeEach already created 3 top-level issues (Bug 1, Feature 1, Task 1).
      // Create a child issue under the first one.
      const allRes = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      const parentId = allRes.json()[0].id;

      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Child Issue", type: "task", priority: "low", parentId },
      });

      // Without filter → all 4 issues returned (backward compatibility)
      const allIssues = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(allIssues.statusCode).toBe(200);
      expect(allIssues.json().length).toBe(4);

      // With parent_only=true → only 3 top-level issues returned
      const parentOnly = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues?parent_only=true`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(parentOnly.statusCode).toBe(200);
      const parents = parentOnly.json();
      expect(parents.length).toBe(3);
      // Verify none of the returned issues have a parentId
      for (const issue of parents) {
        expect(issue.parentId).toBeNull();
      }
    });
  });

  // ── Get Issue with Children ─────────────────────────────────────────

  describe("GET /api/issues/:key", () => {
    it("returns issue with children array", async () => {
      // Create a parent issue
      const parentRes = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Parent Epic", type: "feature", priority: "high", labels: ["backend"] },
      });
      expect(parentRes.statusCode).toBe(201);
      const parent = parentRes.json();

      // Create two child issues
      const child1Res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Child Task 1", type: "task", priority: "medium", parentId: parent.id, labels: ["api"] },
      });
      expect(child1Res.statusCode).toBe(201);

      const child2Res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Child Task 2", type: "bug", priority: "low", parentId: parent.id, labels: ["ui"] },
      });
      expect(child2Res.statusCode).toBe(201);

      // Get parent issue → should include children
      const getRes = await app.inject({
        method: "GET",
        url: `/api/issues/${parent.key}`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.key).toBe(parent.key);
      expect(Array.isArray(body.children)).toBe(true);
      expect(body.children.length).toBe(2);

      // Verify children have the expected fields
      for (const child of body.children) {
        expect(child).toHaveProperty("id");
        expect(child).toHaveProperty("key");
        expect(child).toHaveProperty("title");
        expect(child).toHaveProperty("state");
        expect(child).toHaveProperty("labels");
      }

      // Verify child data matches what was created
      const childTitles = body.children.map((c: { title: string }) => c.title).sort();
      expect(childTitles).toEqual(["Child Task 1", "Child Task 2"]);
    });

    it("returns empty children array for issue with no children", async () => {
      const issueRes = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Leaf Issue", type: "task", priority: "medium" },
      });
      expect(issueRes.statusCode).toBe(201);
      const issue = issueRes.json();

      const getRes = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(Array.isArray(body.children)).toBe(true);
      expect(body.children.length).toBe(0);
    });
  });

  // ── Issue Group Aggregation ─────────────────────────────────────────

  describe("GET /api/projects/:key/issues/groups", () => {
    beforeEach(async () => {
      // Create issues with different groupKeys
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Auth Spec", type: "task", groupKey: "sdd/auth" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Auth Design", type: "task", groupKey: "sdd/auth" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "UI Proposal", type: "feature", groupKey: "sdd/ui" },
      });
      // Ungrouped issue (should NOT appear in groups)
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Ungrouped Task", type: "task" },
      });
    });

    it("returns aggregated group summaries", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues/groups`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);

      // Find each group
      const authGroup = body.find((g: any) => g.groupKey === "sdd/auth");
      const uiGroup = body.find((g: any) => g.groupKey === "sdd/ui");

      expect(authGroup).toBeDefined();
      expect(authGroup.count).toBe(2);
      expect(authGroup.latestState).toBe("backlog");
      expect(authGroup.title).toBeDefined();
      expect(authGroup.updatedAt).toBeDefined();

      expect(uiGroup).toBeDefined();
      expect(uiGroup.count).toBe(1);
    });

    it("returns empty array for project with no grouped issues", async () => {
      // Create a fresh project with no grouped issues
      const emptyProject = await seedTestProject(workspaceId, "EMP");
      await app.inject({
        method: "POST",
        url: `/api/projects/${emptyProject.key}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "No Group", type: "task" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${emptyProject.key}/issues/groups`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── Group Key Filter on listIssues ────────────────────────────────

  describe("GET /api/projects/:key/issues?group_key=", () => {
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Auth 1", type: "task", groupKey: "sdd/auth" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Auth 2", type: "task", groupKey: "sdd/auth" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Other", type: "task", groupKey: "sdd/other" },
      });
    });

    it("filters issues by group_key", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues?group_key=sdd/auth`,
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBe(2);
      for (const issue of body) {
        expect(issue.groupKey).toBe("sdd/auth");
      }
    });
  });

  // ── Issue Templates ──────────────────────────────────────────────

  describe("POST /api/projects/:key/issues — templateKey", () => {
    it("creates issue with bug-report template defaults", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Login button crashes app",
          templateKey: "bug-report",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.type).toBe("bug");
      expect(body.priority).toBe("high");
      expect(body.labels).toContain("bug");
      expect(body.description).toContain("## Steps to Reproduce");
    });

    it("creates issue with spike template defaults", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Investigate GraphQL migration",
          templateKey: "spike",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.type).toBe("spike");
      expect(body.labels).toContain("investigation");
      expect(body.description).toContain("## Question");
    });

    it("user-supplied type and priority override template defaults", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Custom feature request",
          templateKey: "feature-request",
          type: "task",
          priority: "low",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // User-supplied fields win over template
      expect(body.type).toBe("task");
      expect(body.priority).toBe("low");
      // Labels from template still apply (user did not supply labels)
      expect(body.labels).toContain("enhancement");
    });

    it("user-supplied description overrides template description", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Bug with custom description",
          templateKey: "bug-report",
          description: "My own description",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.description).toBe("My own description");
    });

    it("user-supplied labels override template labels", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Bug with custom labels",
          templateKey: "bug-report",
          labels: ["critical", "frontend"],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // User labels win — template "bug" label should NOT be present
      expect(body.labels).toContain("critical");
      expect(body.labels).toContain("frontend");
      expect(body.labels).not.toContain("bug");
    });

    it("works without templateKey — backwards compatible", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Plain issue without template",
          type: "task",
          priority: "medium",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.title).toBe("Plain issue without template");
      expect(body.type).toBe("task");
      expect(body.priority).toBe("medium");
    });

    it("returns 400 for an invalid templateKey", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          title: "Issue with bad template",
          templateKey: "does-not-exist",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("INVALID_TEMPLATE_KEY");
    });
  });

  // ── Batch Group Transition ────────────────────────────────────────

  describe("PATCH /api/projects/:key/issues/groups/:groupKey/transition", () => {
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Group Issue 1", type: "task", groupKey: "sdd/batch" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Group Issue 2", type: "task", groupKey: "sdd/batch" },
      });
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { title: "Group Issue 3", type: "task", groupKey: "sdd/batch" },
      });
    });

    it("transitions all issues in a group to a new state", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectKey}/issues/groups/sdd%2Fbatch/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(3);
      expect(body.groupKey).toBe("sdd/batch");
      expect(body.state).toBe("apply");

      // Verify all issues actually transitioned
      const issuesRes = await app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/issues?group_key=sdd/batch`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      const issues = issuesRes.json();
      expect(issues.length).toBe(3);
      for (const issue of issues) {
        expect(issue.state).toBe("apply");
      }
    });

    it("creates activity logs for each transitioned issue", async () => {
      await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectKey}/issues/groups/sdd%2Fbatch/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      // Check activity logs
      const logs = await prisma.activityLog.findMany({
        where: {
          action: "state_changed",
          details: {
            path: ["batchTransition"],
            equals: true,
          },
        },
      });
      expect(logs.length).toBe(3);
    });

    it("returns 404 for non-existent group", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectKey}/issues/groups/sdd%2Fnonexistent/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("skips issues already in target state", async () => {
      // First, transition all to 'apply'
      await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectKey}/issues/groups/sdd%2Fbatch/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      // Transition again to same state — should update 0
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectKey}/issues/groups/sdd%2Fbatch/transition`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { to_state: "apply" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(0);
    });
  });
});
