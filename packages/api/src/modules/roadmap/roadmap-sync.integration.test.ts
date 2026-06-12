/**
 * Integration tests for syncRoadmapItemStatus (KAN-84 slice 3).
 *
 * Uses the real test DB (same pattern as roadmap.test.ts).
 * Covers every bail branch and the update branch:
 *   (a) issue with no roadmapItemId → no-op
 *   (b) all linked issues done → status becomes "done"
 *   (c) some not done → status becomes "in_progress"
 *   (d) status already matches computed → NO update (idempotent)
 *   (f) issue itself not found → no throw (first null guard fires)
 *
 * The defensive bail branches (issue-missing, roadmapItem-missing race, empty
 * sibling set) are covered deterministically with a stubbed prisma in
 * roadmap-sync.unit.test.ts.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { createIssue } from "../issue/service.js";
import { syncRoadmapItemStatus } from "./roadmap-sync.js";

describe("syncRoadmapItemStatus", () => {
  let projectId: string;
  let memberId: string;

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const project = await seedTestProject(ws.id);
    projectId = project.id;
    memberId = member.id;
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  async function makeRoadmapItem(status: "idea" | "planned" | "in_progress" | "done" = "planned") {
    return prisma.roadmapItem.create({
      data: {
        title: "Test roadmap item",
        projectId,
        status,
      },
    });
  }

  async function makeIssue(opts: {
    roadmapItemId?: string | null;
    state?: "backlog" | "todo" | "in_progress" | "review" | "done";
  } = {}) {
    const issue = await createIssue(
      projectId,
      {
        title: "Test issue",
        type: "task",
        priority: "medium",
      },
      memberId,
    );

    // Apply overrides via direct update (createIssue defaults to backlog)
    return prisma.issue.update({
      where: { id: issue.id },
      data: {
        state: opts.state ?? "backlog",
        roadmapItemId: opts.roadmapItemId !== undefined ? opts.roadmapItemId : null,
      },
    });
  }

  // ── (a) issue with no roadmapItemId → no-op ────────────────────────────────

  it("(a) bails early when issue has no roadmapItemId — roadmapItem unchanged", async () => {
    const roadmapItem = await makeRoadmapItem("planned");
    // Create a standalone issue (no roadmapItemId)
    const issue = await makeIssue({ state: "done" });

    await expect(syncRoadmapItemStatus(prisma, issue.id)).resolves.toBeUndefined();

    // roadmapItem must remain untouched
    const unchanged = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(unchanged?.status).toBe("planned");
  });

  // ── (b) all linked issues done → status becomes "done" ────────────────────

  it("(b) updates roadmapItem to 'done' when all sibling issues are done", async () => {
    const roadmapItem = await makeRoadmapItem("in_progress");
    const issue1 = await makeIssue({ roadmapItemId: roadmapItem.id, state: "done" });
    await makeIssue({ roadmapItemId: roadmapItem.id, state: "done" });

    await syncRoadmapItemStatus(prisma, issue1.id);

    const updated = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(updated?.status).toBe("done");
  });

  it("(b) single done issue → roadmapItem becomes 'done'", async () => {
    const roadmapItem = await makeRoadmapItem("planned");
    const issue = await makeIssue({ roadmapItemId: roadmapItem.id, state: "done" });

    await syncRoadmapItemStatus(prisma, issue.id);

    const updated = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(updated?.status).toBe("done");
  });

  // ── (c) some not done → status becomes "in_progress" ─────────────────────

  it("(c) updates roadmapItem to 'in_progress' when one sibling is not done", async () => {
    const roadmapItem = await makeRoadmapItem("planned");
    const issue1 = await makeIssue({ roadmapItemId: roadmapItem.id, state: "done" });
    await makeIssue({ roadmapItemId: roadmapItem.id, state: "backlog" });

    await syncRoadmapItemStatus(prisma, issue1.id);

    const updated = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(updated?.status).toBe("in_progress");
  });

  it("(c) updates roadmapItem to 'in_progress' when triggered issue is in 'todo' state", async () => {
    const roadmapItem = await makeRoadmapItem("planned");
    const issue = await makeIssue({ roadmapItemId: roadmapItem.id, state: "todo" });

    await syncRoadmapItemStatus(prisma, issue.id);

    const updated = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(updated?.status).toBe("in_progress");
  });

  // ── (d) status already matches computed → NO update ───────────────────────

  it("(d) does NOT write when status already matches 'done' (idempotent)", async () => {
    const roadmapItem = await makeRoadmapItem("done");
    const issue = await makeIssue({ roadmapItemId: roadmapItem.id, state: "done" });

    // Capture updatedAt before the sync call
    const before = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    const beforeUpdatedAt = before!.updatedAt.getTime();

    await syncRoadmapItemStatus(prisma, issue.id);

    const after = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    // No write was performed — updatedAt must be identical
    expect(after!.updatedAt.getTime()).toBe(beforeUpdatedAt);
    expect(after!.status).toBe("done");
  });

  it("(d) does NOT write when status already matches 'in_progress' (idempotent)", async () => {
    const roadmapItem = await makeRoadmapItem("in_progress");
    const issue = await makeIssue({ roadmapItemId: roadmapItem.id, state: "todo" });

    const before = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    const beforeUpdatedAt = before!.updatedAt.getTime();

    await syncRoadmapItemStatus(prisma, issue.id);

    const after = await prisma.roadmapItem.findUnique({ where: { id: roadmapItem.id } });
    expect(after!.updatedAt.getTime()).toBe(beforeUpdatedAt);
    expect(after!.status).toBe("in_progress");
  });

  // ── (e) the roadmapItem-missing race guard and (f) issue-not-found bail are
  //       covered deterministically (stubbed prisma) in roadmap-sync.unit.test.ts.

  // ── (f) issue itself not found → no throw ─────────────────────────────────

  it("(f) does not throw when issueId does not exist (findUnique returns null)", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    await expect(syncRoadmapItemStatus(prisma, nonExistentId)).resolves.toBeUndefined();
  });
});
