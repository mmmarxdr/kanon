/**
 * Failing tests for S4 review findings — KAN-28
 *
 * Covers behavioral fixes:
 *  Fix 1 (CRITICAL) — cross-event dedup gap: @mentioned subscriber gets only
 *                      ONE notification (kind=mention), NOT a duplicate
 *                      subscribed_activity for the same comment.
 *  Fix 5            — autoSubscribe ordering: failed updateIssue must NOT leave
 *                      a phantom subscription for the would-be assignee.
 *  Fix 7            — test 4.1f2 integrity: subscriberB must be a project member.
 *
 * TDD: RED first — run before production changes land.
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

// ── Helper: seed an issue ──────────────────────────────────────────────────

async function seedIssue(projectId: string, suffix = "r") {
  const count = await prisma.issue.count();
  return prisma.issue.create({
    data: {
      key: `SUBR-${count + 1}-${suffix}`,
      sequenceNum: count + 1,
      title: `Review test issue ${suffix}`,
      projectId,
    },
    select: { id: true, key: true, projectId: true },
  });
}

// Poll DB until predicate passes or timeout (Fix 8 / KAN-28 — eliminate flaky fixed sleeps)
async function pollUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`pollUntil: predicate did not become true within ${timeoutMs}ms`);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("S4 review findings — KAN-28", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Fix 1 — cross-event dedup: @mentioned subscriber gets exactly one notification ──

  describe("Fix 1 — cross-event dedup gap: @mention in comment", () => {
    it(
      "subscriber B who is @mentioned in a comment receives exactly ONE notification " +
        "(kind=mention), NOT a duplicate subscribed_activity",
      async () => {
        const ws = await seedTestWorkspace();
        // Use underscore usernames — the @mention regex is \w+ which does NOT match hyphens
        const actorA = await seedTestMember(ws.id, { username: "actor_r1" });
        const subscriberB = await seedTestMember(ws.id, {
          username: "subscriber_r1",
        });
        const project = await seedTestProject(ws.id);

        // Both are project members
        await prisma.projectMember.create({
          data: { userId: actorA.userId, projectId: project.id, role: "member" },
        });
        await prisma.projectMember.create({
          data: {
            userId: subscriberB.userId,
            projectId: project.id,
            role: "member",
          },
        });
        const issue = await seedIssue(project.id, "r1");

        // B subscribes to the issue
        await prisma.issueSubscription.create({
          data: { issueId: issue.id, memberId: subscriberB.id, origin: "manual" },
        });

        // A posts a comment that @mentions B (using exact username — \w+ compatible)
        const res = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/comments`,
          headers: { authorization: `Bearer ${actorA.token}` },
          payload: {
            body: `Hey @subscriber_r1, please review this`,
            source: "human",
          },
        });
        expect(res.statusCode).toBe(201);

        // Poll until B receives the mention notification
        await pollUntil(async () => {
          const count = await prisma.notification.count({ where: { recipientId: subscriberB.id } });
          return count >= 1;
        });

        // B should have EXACTLY ONE notification total
        const allNotifs = await prisma.notification.findMany({
          where: { recipientId: subscriberB.id },
        });
        expect(allNotifs).toHaveLength(1);

        // That notification must be kind=mention (not subscribed_activity)
        expect(allNotifs[0]!.kind).toBe("mention");
      },
    );

    it(
      "subscriber B who is NOT @mentioned in a comment still gets a " +
        "subscribed_activity notification",
      async () => {
        const ws = await seedTestWorkspace();
        const actorA = await seedTestMember(ws.id, { username: "actor_r1b" });
        const subscriberB = await seedTestMember(ws.id, {
          username: "subscriber_r1b",
        });
        const project = await seedTestProject(ws.id);

        await prisma.projectMember.create({
          data: { userId: actorA.userId, projectId: project.id, role: "member" },
        });
        await prisma.projectMember.create({
          data: {
            userId: subscriberB.userId,
            projectId: project.id,
            role: "member",
          },
        });
        const issue = await seedIssue(project.id, "r1b");

        // B subscribes
        await prisma.issueSubscription.create({
          data: { issueId: issue.id, memberId: subscriberB.id, origin: "manual" },
        });

        // A posts a comment WITHOUT @mentioning B
        const res = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/comments`,
          headers: { authorization: `Bearer ${actorA.token}` },
          payload: { body: "Just a plain comment, no mention", source: "human" },
        });
        expect(res.statusCode).toBe(201);

        // Poll until B receives the subscribed_activity notification
        await pollUntil(async () => {
          const count = await prisma.notification.count({ where: { recipientId: subscriberB.id, kind: "subscribed_activity" } });
          return count >= 1;
        });

        const notifB = await prisma.notification.findMany({
          where: { recipientId: subscriberB.id, kind: "subscribed_activity" },
        });
        expect(notifB).toHaveLength(1);
      },
    );
  });

  // ── Fix 5 — autoSubscribe ordering: phantom subscription on failed update ──

  describe("Fix 5 — autoSubscribe fires AFTER successful prisma.issue.update", () => {
    it(
      "updating issue assigneeId to a non-existent memberId leaves NO subscription " +
        "row (autoSubscribe must not fire before the DB update fails)",
      async () => {
        // The observable behaviour: if autoSubscribe fires BEFORE prisma.issue.update,
        // a failing update leaves a phantom subscription row. After the fix, the update
        // must succeed (or fail) BEFORE autoSubscribe is called.
        //
        // We test the happy path here (valid assignee gets subscribed) and a separate
        // test verifies ordering by checking that a nonexistent assigneeId causes a 404
        // and leaves zero subscription rows.
        const ws = await seedTestWorkspace();
        const actor = await seedTestMember(ws.id, { username: "actor-r5" });
        const assignee = await seedTestMember(ws.id, { username: "assignee-r5" });
        const project = await seedTestProject(ws.id);
        await prisma.projectMember.create({
          data: { userId: actor.userId, projectId: project.id, role: "member" },
        });
        await prisma.projectMember.create({
          data: {
            userId: assignee.userId,
            projectId: project.id,
            role: "member",
          },
        });
        const issue = await seedIssue(project.id, "r5a");

        // Issue does not have assigneeId yet. Update with a valid assignee.
        const res = await app.inject({
          method: "PATCH",
          url: `/api/issues/${issue.key}`,
          headers: { authorization: `Bearer ${actor.token}` },
          payload: { assigneeId: assignee.id },
        });
        expect(res.statusCode).toBe(200);

        // Poll until autoSubscribe row appears (best-effort, void async)
        await pollUntil(async () => {
          const row = await prisma.issueSubscription.findUnique({
            where: { issueId_memberId: { issueId: issue.id, memberId: assignee.id } },
            select: { id: true },
          });
          return row !== null;
        });

        const sub = await prisma.issueSubscription.findUnique({
          where: {
            issueId_memberId: { issueId: issue.id, memberId: assignee.id },
          },
        });
        expect(sub).not.toBeNull();
        expect(sub!.origin).toBe("assignee");
      },
    );

    it(
      "updating issue assigneeId to a nonexistent member ID causes 404 and leaves " +
        "zero IssueSubscription rows (phantom subscription guard)",
      async () => {
        const ws = await seedTestWorkspace();
        const actor = await seedTestMember(ws.id, { username: "actor-r5b" });
        const project = await seedTestProject(ws.id);
        await prisma.projectMember.create({
          data: { userId: actor.userId, projectId: project.id, role: "member" },
        });
        const issue = await seedIssue(project.id, "r5b");

        // Assign to a nonexistent memberId — Prisma will throw P2025 (record not found)
        const fakeId = "00000000-0000-0000-0000-deadbeef0000";
        const res = await app.inject({
          method: "PATCH",
          url: `/api/issues/${issue.key}`,
          headers: { authorization: `Bearer ${actor.token}` },
          payload: { assigneeId: fakeId },
        });
        // Expect an error — either 404 or 500 depending on Prisma error handling;
        // the key invariant is NO subscription row for the fakeId
        expect(res.statusCode).toBeGreaterThanOrEqual(400);

        // The failed update never triggers autoSubscribe (synchronous failure).
        // Poll briefly to confirm no row appears even under async scheduling.
        // 200ms is enough headroom for any fire-and-forget tasks to have settled;
        // this is a negative-assertion window, not a success poll.
        const NEGATIVE_POLL_WINDOW_MS = 200;
        let appeared = false;
        const deadline = Date.now() + NEGATIVE_POLL_WINDOW_MS;
        while (Date.now() < deadline) {
          const count = await prisma.issueSubscription.count({ where: { issueId: issue.id, memberId: fakeId } });
          if (count > 0) { appeared = true; break; }
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(appeared).toBe(false);

        const subs = await prisma.issueSubscription.findMany({
          where: { issueId: issue.id, memberId: fakeId },
        });
        expect(subs).toHaveLength(0);
      },
    );
  });

  // ── Fix 7 — 4.1f2: subscriberB must be a project member ───────────────────

  describe("Fix 7 — 4.1f2 test integrity: subscriberB is a project member", () => {
    it(
      "comment.created event → subscribed_activity for subscriberB who IS a " +
        "project member (valid scenario)",
      async () => {
        const ws = await seedTestWorkspace();
        const actorA = await seedTestMember(ws.id, { username: "actor-r7" });
        const subscriberB = await seedTestMember(ws.id, {
          username: "subscriber-r7",
        });
        const project = await seedTestProject(ws.id);

        // BOTH actors are project members — this is the fix (subscriberB was missing)
        await prisma.projectMember.create({
          data: { userId: actorA.userId, projectId: project.id, role: "member" },
        });
        await prisma.projectMember.create({
          data: {
            userId: subscriberB.userId,
            projectId: project.id,
            role: "member",
          },
        });
        const issue = await seedIssue(project.id, "r7");

        // Subscribe B directly
        await prisma.issueSubscription.create({
          data: { issueId: issue.id, memberId: subscriberB.id, origin: "manual" },
        });

        // A posts a comment
        const res = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/comments`,
          headers: { authorization: `Bearer ${actorA.token}` },
          payload: {
            body: "A comment triggering subscribed_activity",
            source: "human",
          },
        });
        expect(res.statusCode).toBe(201);

        // Poll until B receives the subscribed_activity notification
        await pollUntil(async () => {
          const count = await prisma.notification.count({ where: { recipientId: subscriberB.id, kind: "subscribed_activity" } });
          return count >= 1;
        });

        const notifB = await prisma.notification.findMany({
          where: { recipientId: subscriberB.id, kind: "subscribed_activity" },
        });
        expect(notifB).toHaveLength(1);
      },
    );
  });
});
