/**
 * Integration tests — Dashboard endpoint extension (inbox-redesign-cycle-c, A9)
 *
 * Tests:
 *  A9.1 — no active cycle → activeCycle: null, multipleActiveProjects: false
 *  A9.2 — single active cycle → activeCycle fully populated, multipleActiveProjects: false
 *  A9.3 — two active cycles in different projects → activeCycle = most recent, multipleActiveProjects: true
 *  A9.4 — alice has 3 mentions in W1 → mentions returns 3 items with correct shape
 *  A9.5 — multi-tenant isolation: alice has mentions in W1 and W2 → W1 dashboard only returns W1 mentions
 *  A9.6 — bob calls W1 dashboard where only alice has mentions → mentions: []
 *  A9.7 — end-to-end: create comment with @alice → alice dashboard returns that mention
 *  A9.8 — (implementation task, covered by all tests above passing after IMPLEMENT)
 *  A9.x — mentions capped at 20, ordered DESC by createdAt
 *  A9.x — activeCycle.velocity equals completed count (NOT cycle.velocity stored field)
 *  A9.x — activeCycle.multipleActiveProjects=true when workspace has 2+ active cycles
 *  A9.x — mention from issue.description has commentId: null
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

// ─── Local seed helpers ────────────────────────────────────────────────────────

async function seedCycle(
  projectId: string,
  overrides?: {
    state?: "upcoming" | "active" | "done";
    startDate?: Date;
    endDate?: Date;
    name?: string;
  },
) {
  return prisma.cycle.create({
    data: {
      name: overrides?.name ?? "Sprint 1",
      state: overrides?.state ?? "active",
      startDate: overrides?.startDate ?? new Date("2026-04-28"),
      endDate: overrides?.endDate ?? new Date("2026-05-11"),
      projectId,
    },
  });
}

async function seedIssue(
  projectId: string,
  opts?: {
    cycleId?: string;
    state?: string;
    title?: string;
    description?: string | null;
  },
) {
  const count = await prisma.issue.count();
  const seqNum = count + 1;
  return prisma.issue.create({
    data: {
      key: `T${seqNum}`,
      sequenceNum: seqNum,
      title: opts?.title ?? `Issue ${seqNum}`,
      state: (opts?.state ?? "backlog") as "backlog",
      description: opts?.description ?? null,
      projectId,
      ...(opts?.cycleId ? { cycleId: opts.cycleId } : {}),
    },
  });
}

/**
 * Create a Mention row directly in DB (bypasses parser for isolation).
 */
async function seedMention(params: {
  workspaceId: string;
  issueId: string;
  commentId?: string | null;
  mentionedMemberId: string;
  mentionedByMemberId: string;
  context?: string;
  createdAt?: Date;
}) {
  return prisma.mention.create({
    data: {
      workspaceId: params.workspaceId,
      issueId: params.issueId,
      commentId: params.commentId ?? null,
      mentionedMemberId: params.mentionedMemberId,
      mentionedByMemberId: params.mentionedByMemberId,
      context: params.context ?? "@alice check this",
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });
}

/**
 * Create a comment row directly in DB.
 * Note: Comment schema uses `authorId` (not `memberId`).
 */
async function seedComment(params: {
  issueId: string;
  authorId: string;
  body: string;
}) {
  return prisma.comment.create({
    data: {
      issueId: params.issueId,
      authorId: params.authorId,
      body: params.body,
    },
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Dashboard route extension (A9 — inbox-redesign-cycle-c)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    // cleanDatabase does not include mention.deleteMany — add it here first
    await prisma.mention.deleteMany();
    await cleanDatabase();
  });

  // ── A9.1 — no active cycle ─────────────────────────────────────────────────

  it("A9.1 — activeCycle is null when workspace has no active cycles", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      activeCycle: null;
      multipleActiveProjects: boolean;
      mentions: unknown[];
    }>();
    expect(body.activeCycle).toBeNull();
    expect(body.multipleActiveProjects).toBe(false);
    expect(Array.isArray(body.mentions)).toBe(true);
  });

  // ── A9.2 — single active cycle → full ActiveCycleKPIs shape ───────────────

  it("A9.2 — single active cycle populates activeCycle with full shape", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const project = await seedTestProject(ws.id);
    const cycle = await seedCycle(project.id, {
      name: "Sprint Alpha",
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-05-14"),
    });

    // Seed one done issue and one backlog issue
    await seedIssue(project.id, { cycleId: cycle.id, state: "done" });
    await seedIssue(project.id, { cycleId: cycle.id, state: "backlog" });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      activeCycle: {
        id: string;
        name: string;
        projectName: string;
        startDate: string;
        endDate: string;
        completed: number;
        scope: number;
        donePct: number;
        velocity: number;
        avgLeadDays: number | null;
        burnup: number[];
        multipleActiveProjects: boolean;
      };
      multipleActiveProjects: boolean;
    }>();

    expect(body.activeCycle).not.toBeNull();
    const ac = body.activeCycle!;

    // Shape verification
    expect(typeof ac.id).toBe("string");
    expect(ac.name).toBe("Sprint Alpha");
    expect(typeof ac.projectName).toBe("string");
    expect(typeof ac.startDate).toBe("string");
    expect(typeof ac.endDate).toBe("string");
    expect(typeof ac.completed).toBe("number");
    expect(typeof ac.scope).toBe("number");
    expect(typeof ac.donePct).toBe("number");
    expect(ac.donePct).toBeGreaterThanOrEqual(0);
    expect(ac.donePct).toBeLessThanOrEqual(100);
    expect(typeof ac.velocity).toBe("number");
    // avgLeadDays may be null (no state_changed→done events in seeds)
    expect(ac.avgLeadDays === null || typeof ac.avgLeadDays === "number").toBe(true);
    expect(Array.isArray(ac.burnup)).toBe(true);

    expect(body.multipleActiveProjects).toBe(false);
  });

  // ── A9.3 — two active cycles in different projects → most recent wins, multipleActiveProjects=true

  it("A9.3 — two active cycles in different projects → activeCycle = most recent startDate, multipleActiveProjects=true", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const project1 = await seedTestProject(ws.id, "PRJ");
    const project2 = await seedTestProject(ws.id, "ATL");

    // older cycle in project1, newer cycle in project2
    await seedCycle(project1.id, {
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-04-14"),
      name: "Old Sprint",
    });
    const newerCycle = await seedCycle(project2.id, {
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-05-14"),
      name: "New Sprint",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      activeCycle: { id: string; name: string; startDate: string };
      multipleActiveProjects: boolean;
    }>();

    expect(body.activeCycle).not.toBeNull();
    expect(body.activeCycle!.id).toBe(newerCycle.id);
    expect(body.activeCycle!.name).toBe("New Sprint");
    expect(body.multipleActiveProjects).toBe(true);
  });

  // ── A9.4 — alice has 3 mentions → mentions returns 3 items with full shape ─

  it("A9.4 — alice has 3 mentions in W1 → mentions returns 3 items with correct shape", async () => {
    const ws = await seedTestWorkspace();
    const alice = await seedTestMember(ws.id, { username: "alice" });
    const bob = await seedTestMember(ws.id, { username: "bob" });
    const project = await seedTestProject(ws.id);
    const issue = await seedIssue(project.id);
    const comment = await seedComment({ issueId: issue.id, authorId: bob.id, body: "@alice check this" });

    // Create 3 mentions for alice (all in W1)
    await seedMention({
      workspaceId: ws.id,
      issueId: issue.id,
      commentId: comment.id,
      mentionedMemberId: alice.id,
      mentionedByMemberId: bob.id,
      context: "@alice first mention",
    });
    await seedMention({
      workspaceId: ws.id,
      issueId: issue.id,
      commentId: null,  // description mention
      mentionedMemberId: alice.id,
      mentionedByMemberId: bob.id,
      context: "@alice second mention in description",
    });
    // Create a second comment for the third mention
    const comment2 = await seedComment({ issueId: issue.id, authorId: bob.id, body: "@alice third" });
    await seedMention({
      workspaceId: ws.id,
      issueId: issue.id,
      commentId: comment2.id,
      mentionedMemberId: alice.id,
      mentionedByMemberId: bob.id,
      context: "@alice third mention",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${alice.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      mentions: Array<{
        id: string;
        issueKey: string;
        issueTitle: string;
        commentId: string | null;
        mentionedByUsername: string;
        context: string;
        createdAt: string;
      }>;
    }>();

    expect(body.mentions).toHaveLength(3);

    for (const m of body.mentions) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.issueKey).toBe("string");
      expect(typeof m.issueTitle).toBe("string");
      // commentId can be string or null
      expect(m.commentId === null || typeof m.commentId === "string").toBe(true);
      expect(typeof m.mentionedByUsername).toBe("string");
      expect(typeof m.context).toBe("string");
      expect(typeof m.createdAt).toBe("string");
    }

    // The description mention should have commentId: null
    const descMention = body.mentions.find((m) => m.context.includes("description"));
    expect(descMention).toBeDefined();
    expect(descMention!.commentId).toBeNull();
  });

  // ── A9.5 — multi-tenant isolation: alice in W1+W2, W1 dashboard only returns W1 mentions ─

  it("A9.5 — alice in W1+W2 → W1 dashboard returns only W1 mentions", async () => {
    const ws1 = await seedTestWorkspace();
    const ws2 = await seedTestWorkspace();

    // Alice is a member in both workspaces
    const alice1 = await seedTestMember(ws1.id, { username: "alice" });
    const alice2 = await seedTestMember(ws2.id, { username: "alice" });
    const bob1 = await seedTestMember(ws1.id, { username: "bob" });
    const bob2 = await seedTestMember(ws2.id, { username: "bob2" });

    const proj1 = await seedTestProject(ws1.id, "P1A");
    const proj2 = await seedTestProject(ws2.id, "P2A");
    const issue1 = await seedIssue(proj1.id);
    const issue2 = await seedIssue(proj2.id);

    // 2 mentions in W1, 3 mentions in W2 — all for alice
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice second W1" });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice second W2" });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice third W2" });

    // Alice calls W1 dashboard
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws1.id}/dashboard`,
      headers: { authorization: `Bearer ${alice1.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: Array<{ workspaceId?: string }> }>();
    // Should only see W1 mentions (2)
    expect(body.mentions).toHaveLength(2);
  });

  // ── A9.6 — bob calls W1 dashboard where only alice has mentions → mentions: [] ─

  it("A9.6 — bob sees empty mentions when only alice has mentions in W1", async () => {
    const ws = await seedTestWorkspace();
    const alice = await seedTestMember(ws.id, { username: "alice" });
    const bob = await seedTestMember(ws.id, { username: "bob" });
    const project = await seedTestProject(ws.id);
    const issue = await seedIssue(project.id);

    // Only alice has mentions
    await seedMention({
      workspaceId: ws.id,
      issueId: issue.id,
      mentionedMemberId: alice.id,
      mentionedByMemberId: bob.id,
      context: "@alice check this",
    });

    // Bob calls the dashboard
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${bob.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: unknown[] }>();
    expect(body.mentions).toHaveLength(0);
  });

  // ── A9.7 — end-to-end: create comment with @alice via API → alice dashboard includes it ─

  it("A9.7 — comment created with @alice via API → alice dashboard mentions returns that mention", async () => {
    const ws = await seedTestWorkspace();
    const alice = await seedTestMember(ws.id, { username: "alice" });
    const bob = await seedTestMember(ws.id, { username: "bob" });
    const project = await seedTestProject(ws.id);

    // Create an issue via API (route: POST /api/projects/:key/issues)
    const issueRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: { authorization: `Bearer ${bob.token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Test issue for mention" }),
    });
    expect(issueRes.statusCode).toBe(201);
    const issue = issueRes.json<{ id: string; key: string }>();

    // Bob creates a comment mentioning @alice (route: POST /api/issues/:key/comments)
    const commentRes = await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/comments`,
      headers: { authorization: `Bearer ${bob.token}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "@alice please review this" }),
    });
    expect(commentRes.statusCode).toBe(201);

    // Alice's dashboard should show that mention
    const dashRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${alice.token}` },
    });

    expect(dashRes.statusCode).toBe(200);
    const body = dashRes.json<{
      mentions: Array<{
        mentionedByUsername: string;
        context: string;
        issueKey: string;
      }>;
    }>();

    expect(body.mentions.length).toBeGreaterThanOrEqual(1);
    const aliceMention = body.mentions.find((m) => m.issueKey === issue.key);
    expect(aliceMention).toBeDefined();
    expect(aliceMention!.mentionedByUsername).toBe("bob");
    expect(aliceMention!.context).toContain("@alice");
  });

  // ── mentions capped at 20, ordered DESC by createdAt ─────────────────────────

  it("mentions are limited to 20 and ordered DESC by createdAt", async () => {
    const ws = await seedTestWorkspace();
    const alice = await seedTestMember(ws.id, { username: "alice" });
    const bob = await seedTestMember(ws.id, { username: "bob" });
    const project = await seedTestProject(ws.id);
    const issue = await seedIssue(project.id);

    // Create 25 mentions with different timestamps
    const base = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 25; i++) {
      const ts = new Date(base.getTime() + i * 60_000); // +1 min each
      await seedMention({
        workspaceId: ws.id,
        issueId: issue.id,
        mentionedMemberId: alice.id,
        mentionedByMemberId: bob.id,
        context: `@alice mention ${i}`,
        createdAt: ts,
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${alice.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: Array<{ createdAt: string; context: string }> }>();

    // Capped at 20
    expect(body.mentions).toHaveLength(20);

    // Ordered DESC by createdAt (first item should have the latest timestamp)
    const dates = body.mentions.map((m) => new Date(m.createdAt).getTime());
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i]!).toBeGreaterThanOrEqual(dates[i + 1]!);
    }
  });

  // ── activeCycle.velocity === completed count (NOT cycle.velocity stored field) ─

  it("activeCycle.velocity equals completed issue count, not stored cycle.velocity", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const project = await seedTestProject(ws.id);
    const cycle = await seedCycle(project.id, { state: "active" });

    // Seed 3 done issues and 2 backlog issues (each estimate is null → counts as 1 point each)
    for (let i = 0; i < 3; i++) {
      await seedIssue(project.id, { cycleId: cycle.id, state: "done" });
    }
    for (let i = 0; i < 2; i++) {
      await seedIssue(project.id, { cycleId: cycle.id, state: "backlog" });
    }

    // cycle.velocity in DB is null (cycle is still active, was never closed)
    // The expected velocity = completed = 3 (points for 3 done issues with null estimate = 1 each)
    const cycleInDb = await prisma.cycle.findUnique({ where: { id: cycle.id } });
    expect(cycleInDb!.velocity).toBeNull(); // confirm stored field is null

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activeCycle: { velocity: number; completed: number } }>();

    expect(body.activeCycle).not.toBeNull();
    // velocity must equal completed (both = 3 points for 3 done issues)
    expect(body.activeCycle!.velocity).toBe(body.activeCycle!.completed);
    expect(body.activeCycle!.velocity).toBe(3);
  });

  // ── activeCycle.multipleActiveProjects=true when 2+ active cycles ──────────

  it("activeCycle.multipleActiveProjects is true when workspace has 2+ projects with active cycles", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const proj1 = await seedTestProject(ws.id, "MA1");
    const proj2 = await seedTestProject(ws.id, "MA2");

    await seedCycle(proj1.id, { state: "active", startDate: new Date("2026-04-15") });
    await seedCycle(proj2.id, { state: "active", startDate: new Date("2026-05-01") });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/dashboard`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activeCycle: { id: string }; multipleActiveProjects: boolean }>();
    expect(body.multipleActiveProjects).toBe(true);
    expect(body.activeCycle).not.toBeNull();
  });
});
