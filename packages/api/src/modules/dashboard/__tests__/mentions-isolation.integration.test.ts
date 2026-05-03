/**
 * C5.1 — Multi-tenant isolation contract test (API)
 *
 * Contract: The dashboard endpoint MUST only return mentions for the
 * authenticated member in the requested workspace. Mentions from:
 *   - Other workspaces (same user, different workspace) → MUST NOT appear
 *   - Other members in the same workspace → MUST NOT appear
 *
 * This is a regression guard ensuring frontend receives already-isolated data
 * from the backend (REQ-MENTION-006, REQ-API-DASHBOARD-004).
 *
 * Test scenarios:
 *   C5.1a — alice has 3 mentions in W1 and 2 mentions in W2 → W1 dashboard returns exactly 3
 *   C5.1b — bob calls W1 dashboard where only alice has mentions → mentions: []
 *   C5.1c — alice calls W2 dashboard → returns exactly 2 (W2 mentions, not W1)
 *
 * Refs: REQ-MENTION-006 escenarios 1-3, REQ-API-DASHBOARD-004 escenarios 1-3, design §6
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

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedIssue(projectId: string) {
  const count = await prisma.issue.count();
  const seqNum = count + 1;
  return prisma.issue.create({
    data: {
      key: `ISO${seqNum}`,
      sequenceNum: seqNum,
      title: `Isolation Issue ${seqNum}`,
      state: "backlog" as "backlog",
      projectId,
    },
  });
}

async function seedMention(params: {
  workspaceId: string;
  issueId: string;
  mentionedMemberId: string;
  mentionedByMemberId: string;
  context?: string;
}) {
  return prisma.mention.create({
    data: {
      workspaceId: params.workspaceId,
      issueId: params.issueId,
      commentId: null,
      mentionedMemberId: params.mentionedMemberId,
      mentionedByMemberId: params.mentionedByMemberId,
      context: params.context ?? "@alice check this",
    },
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Mentions multi-tenant isolation contract (C5 — inbox-redesign-cycle-c)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await prisma.mention.deleteMany();
    await cleanDatabase();
  });

  it("C5.1a — alice in W1 and W2: W1 dashboard returns ONLY W1 mentions (not W2)", async () => {
    // Set up W1
    const ws1 = await seedTestWorkspace();
    const alice1 = await seedTestMember(ws1.id, { username: "alice" });
    const bob1 = await seedTestMember(ws1.id, { username: "bob" });
    const project1 = await seedTestProject(ws1.id);
    const issue1 = await seedIssue(project1.id);

    // Set up W2
    const ws2 = await seedTestWorkspace();
    const alice2 = await seedTestMember(ws2.id, { username: "alice" });
    const bob2 = await seedTestMember(ws2.id, { username: "bob" });
    const project2 = await seedTestProject(ws2.id);
    const issue2 = await seedIssue(project2.id);

    // Create 3 mentions for alice in W1
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1 first" });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1 second" });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1 third" });

    // Create 2 mentions for alice in W2
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice W2 first" });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice W2 second" });

    // Alice calls W1 dashboard
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws1.id}/dashboard`,
      headers: { authorization: `Bearer ${alice1.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: Array<{ context: string }> }>();

    // Contract: ONLY W1 mentions (3), not W2 (2)
    expect(body.mentions).toHaveLength(3);
    // All returned mentions should be W1 mentions
    for (const m of body.mentions) {
      expect(m.context).toContain("W1");
    }
    // No W2 mention should leak through
    const hasW2Leak = body.mentions.some((m) => m.context.includes("W2"));
    expect(hasW2Leak).toBe(false);
  });

  it("C5.1b — bob calls W1 dashboard where only alice has mentions → mentions: []", async () => {
    const ws1 = await seedTestWorkspace();
    const alice = await seedTestMember(ws1.id, { username: "alice" });
    const bob = await seedTestMember(ws1.id, { username: "bob" });
    const project1 = await seedTestProject(ws1.id);
    const issue1 = await seedIssue(project1.id);

    // 2 mentions for alice only
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice.id, mentionedByMemberId: bob.id });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice.id, mentionedByMemberId: bob.id, context: "@alice second" });

    // Bob calls dashboard — should see no mentions (none are for him)
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws1.id}/dashboard`,
      headers: { authorization: `Bearer ${bob.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: unknown[] }>();
    expect(body.mentions).toHaveLength(0);
  });

  it("C5.1c — alice calls W2 dashboard → returns only W2 mentions (not W1)", async () => {
    const ws1 = await seedTestWorkspace();
    const alice1 = await seedTestMember(ws1.id, { username: "alice" });
    const bob1 = await seedTestMember(ws1.id, { username: "bob" });
    const project1 = await seedTestProject(ws1.id);
    const issue1 = await seedIssue(project1.id);

    const ws2 = await seedTestWorkspace();
    const alice2 = await seedTestMember(ws2.id, { username: "alice" });
    const bob2 = await seedTestMember(ws2.id, { username: "bob" });
    const project2 = await seedTestProject(ws2.id);
    const issue2 = await seedIssue(project2.id);

    // 3 mentions in W1, 2 in W2 — all for alice
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1" });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1 second" });
    await seedMention({ workspaceId: ws1.id, issueId: issue1.id, mentionedMemberId: alice1.id, mentionedByMemberId: bob1.id, context: "@alice W1 third" });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice W2" });
    await seedMention({ workspaceId: ws2.id, issueId: issue2.id, mentionedMemberId: alice2.id, mentionedByMemberId: bob2.id, context: "@alice W2 second" });

    // Alice calls W2 dashboard
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws2.id}/dashboard`,
      headers: { authorization: `Bearer ${alice2.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ mentions: Array<{ context: string }> }>();

    // Contract: ONLY W2 mentions (2)
    expect(body.mentions).toHaveLength(2);
    for (const m of body.mentions) {
      expect(m.context).toContain("W2");
    }
  });
});
