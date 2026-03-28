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
import { computeStatus } from "./roadmap-sync.js";

// ─── Task 5.1: Unit tests for computeStatus() ──────────────────────────────

describe("computeStatus()", () => {
  it("returns 'done' when all issues are archived", () => {
    const issues = [
      { state: "archived" as const },
      { state: "archived" as const },
      { state: "archived" as const },
    ];
    expect(computeStatus(issues)).toBe("done");
  });

  it("returns 'in_progress' when issues have mixed states", () => {
    const issues = [
      { state: "archived" as const },
      { state: "apply" as const },
      { state: "archived" as const },
    ];
    expect(computeStatus(issues)).toBe("in_progress");
  });

  it("returns 'in_progress' when no issues are archived", () => {
    const issues = [
      { state: "backlog" as const },
      { state: "explore" as const },
    ];
    expect(computeStatus(issues)).toBe("in_progress");
  });

  it("returns null when the issue list is empty", () => {
    expect(computeStatus([])).toBeNull();
  });

  it("returns 'done' for a single archived issue", () => {
    expect(computeStatus([{ state: "archived" as const }])).toBe("done");
  });

  it("returns 'in_progress' for a single non-archived issue", () => {
    expect(computeStatus([{ state: "verify" as const }])).toBe("in_progress");
  });
});

// ─── Task 5.2: Unit tests for syncRoadmapItemStatus() guard clauses ────────

describe("syncRoadmapItemStatus() guard clauses", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectKey: string;
  let memberId: string;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("sync-guard-test");
    workspaceId = ws.id;
    const member = await seedTestMember(workspaceId);
    memberId = member.id;
    token = member.token;
    const project = await seedTestProject(workspaceId, "SGD");
    projectKey = project.key;
  });

  it("bails when issue has no roadmapItemId", async () => {
    // Import the function under test
    const { syncRoadmapItemStatus } = await import("./roadmap-sync.js");

    // Create an issue with no roadmap item link
    const issueRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/issues`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "No roadmap link" },
    });
    const issue = issueRes.json();

    // Should not throw — just return without doing anything
    await expect(
      syncRoadmapItemStatus(prisma, issue.id),
    ).resolves.toBeUndefined();
  });

  it("skips update when computed status matches current status", async () => {
    // Create a roadmap item and promote it to create a linked issue
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Guard test item" },
    });
    const roadmapItem = createRes.json();

    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const issue = promoteRes.json();

    // The issue is in "backlog" state (non-archived), so computed status = in_progress
    // Set the roadmap item status to in_progress so it matches
    await prisma.roadmapItem.update({
      where: { id: roadmapItem.id },
      data: { status: "in_progress" },
    });

    const { syncRoadmapItemStatus } = await import("./roadmap-sync.js");

    // Get the item's updatedAt before sync
    const before = await prisma.roadmapItem.findUnique({
      where: { id: roadmapItem.id },
      select: { status: true },
    });

    await syncRoadmapItemStatus(prisma, issue.id);

    // Status should still be in_progress (no change)
    const after = await prisma.roadmapItem.findUnique({
      where: { id: roadmapItem.id },
      select: { status: true },
    });

    expect(after!.status).toBe("in_progress");
    expect(after!.status).toBe(before!.status);
  });
});

// ─── Tasks 5.3–5.6: Integration tests ──────────────────────────────────────

describe("Roadmap Auto-Lifecycle Integration", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectKey: string;
  let memberId: string;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("lifecycle-test");
    workspaceId = ws.id;
    const member = await seedTestMember(workspaceId);
    memberId = member.id;
    token = member.token;
    const project = await seedTestProject(workspaceId, "LCT");
    projectKey = project.key;
  });

  // ── Task 5.3: Transition all issues to archived → status=done ────────

  it("sets roadmap item status to 'done' when all linked issues are archived", async () => {
    // Create a roadmap item
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Lifecycle done test" },
    });
    const roadmapItem = createRes.json();

    // Promote to create a linked issue
    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const issue = promoteRes.json();

    // Transition the issue all the way to archived
    await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { to_state: "archived" },
    });

    // Verify roadmap item status is now done
    const itemRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(itemRes.json().status).toBe("done");
  });

  // ── Task 5.4: Auto-promote on horizon→now with no issues ─────────────

  it("auto-creates issue and sets status to 'in_progress' when horizon changes to now with no linked issues", async () => {
    // Create a roadmap item with horizon "next" (not "now")
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Auto-promote test", horizon: "next" },
    });
    const roadmapItem = createRes.json();
    expect(roadmapItem.status).toBe("idea");

    // Update horizon to "now" — should trigger auto-promotion
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { horizon: "now" },
    });

    // Verify an issue was created linked to the roadmap item
    const itemRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const itemBody = itemRes.json();

    expect(itemBody.promoted).toBe(true);
    expect(itemBody.issues).toBeDefined();
    expect(itemBody.issues.length).toBeGreaterThanOrEqual(1);

    // Verify roadmap item status is in_progress
    expect(itemBody.status).toBe("in_progress");
  });

  // ── Task 5.5: Reopen issue from archived → status back to in_progress ──

  it("sets status back to 'in_progress' when a done item has an issue reopened", async () => {
    // Create roadmap item and promote
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Reopen test" },
    });
    const roadmapItem = createRes.json();

    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const issue = promoteRes.json();

    // Transition to archived → status should become done
    await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { to_state: "archived" },
    });

    // Confirm done
    const doneRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(doneRes.json().status).toBe("done");

    // Reopen the issue — transition back from archived to backlog
    await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { to_state: "backlog" },
    });

    // Verify status is back to in_progress
    const reopenRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reopenRes.json().status).toBe("in_progress");
  });

  // ── Task 5.6: Batch transition dedup ──────────────────────────────────

  it("correctly syncs status after batch transition of multiple issues on same roadmap item", async () => {
    // Create roadmap item
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Batch test" },
    });
    const roadmapItem = createRes.json();

    // Create 3 issues linked to the same roadmap item via a shared group key
    const groupKey = "batch-test-group";
    const issueKeys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const issueRes = await app.inject({
        method: "POST",
        url: `/api/projects/${projectKey}/issues`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: `Batch issue ${i + 1}`,
          groupKey,
        },
      });
      const issue = issueRes.json();
      issueKeys.push(issue.key);

      // Link each issue to the roadmap item
      await prisma.issue.update({
        where: { id: issue.id },
        data: { roadmapItemId: roadmapItem.id },
      });
    }

    // Mark roadmap item as promoted (since issues are linked)
    await prisma.roadmapItem.update({
      where: { id: roadmapItem.id },
      data: { promoted: true },
    });

    // Batch transition all 3 issues to archived using the group transition endpoint
    const batchRes = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/issues/groups/${groupKey}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { to_state: "archived" },
    });
    expect(batchRes.statusCode).toBe(200);

    // Verify roadmap item status is done (all issues archived)
    const itemRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(itemRes.json().status).toBe("done");

    // Also verify all 3 issues are indeed archived
    for (const key of issueKeys) {
      const issueRes = await app.inject({
        method: "GET",
        url: `/api/issues/${key}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(issueRes.json().state).toBe("archived");
    }
  });
});
